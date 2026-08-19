import { mkdir, readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { MdxxError } from "../shared/errors.ts";
import { clientEntry } from "./client-entry.ts";
import { mdxPlugin } from "./compile.ts";
import { serverEntry } from "./server-entry.ts";
import type { EmittedAssets } from "../assets/emit.ts";
import { sha256 } from "../shared/digest.ts";

export interface RenderBundles {
  serverPath: string;
  clientJavaScript: string;
  css: string[];
}

export interface BundleDependencies {
  directory: string;
  mappings: Map<string, string>;
}

function entryPlugin(name: string, contents: string): Bun.BunPlugin {
  return {
    name: `mdxx-${name}`,
    setup(builder) {
      builder.onResolve({ filter: new RegExp(`^${name}$`) }, () => ({ path: name, namespace: "mdxx-entry" }));
      builder.onLoad({ filter: /.*/, namespace: "mdxx-entry" }, () => ({ contents, loader: "tsx" }));
    },
  };
}

function runtimePlugin(): Bun.BunPlugin {
  return {
    name: "mdxx-runtime",
    setup(builder) {
      builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({
        path: Bun.resolveSync(path, import.meta.dir),
      }));
    },
  };
}

function dependencyPlugin(dependencies?: BundleDependencies): Bun.BunPlugin {
  return {
    name: "mdxx-dependencies",
    setup(builder) {
      if (!dependencies) return;
      builder.onResolve({ filter: /^[^.\/]|^@/ }, ({ path, importer }) => {
        if (path.includes(":")) return undefined;
        if (importer.startsWith(dependencies.directory)) return undefined;
        const mapped = dependencies.mappings.get(path);
        if (!mapped) return undefined;
        try {
          return { path: Bun.resolveSync(mapped, dependencies.directory) };
        } catch {
          return undefined;
        }
      });
    },
  };
}

function assetPlugin(assets?: EmittedAssets): Bun.BunPlugin {
  return {
    name: "mdxx-assets",
    setup(builder) {
      if (!assets) return;
      builder.onResolve({ filter: /^https:\/\/mdxx\.invalid\// }, ({ path }) => ({ path, external: true }));
      builder.onResolve({ filter: /^\.?\.?\// }, ({ path, importer }) => {
        const reference = assets.references.find((item) => item.importer === importer && item.specifier === path && item.resolved);
        if (!reference?.resolved || !assets.urls.has(reference.resolved)) return undefined;
        return { path: reference.resolved, namespace: "mdxx-asset" };
      });
      builder.onLoad({ filter: /.*/, namespace: "mdxx-asset" }, ({ path }) => ({
        contents: `export default ${JSON.stringify(assets.urls.get(path))}`,
        loader: "js",
      }));
      builder.onLoad({ filter: /\.(?:css|ts|tsx|js|jsx|mjs|mts)$/ }, async ({ path }) => {
        if (path.includes("node_modules")) return undefined;
        const references = assets.references.filter((item) => item.importer === path && item.resolved);
        if (references.length === 0) return undefined;
        let contents = await Bun.file(path).text();
        const css = path.endsWith(".css");
        for (const reference of references) {
          const url = reference.resolved ? assets.urls.get(reference.resolved) : undefined;
          if (url) contents = contents.replaceAll(reference.specifier, css ? `https://mdxx.invalid/${url}` : url);
        }
        const extension = path.slice(path.lastIndexOf(".") + 1);
        return { contents, loader: extension as "css" | "ts" | "tsx" | "js" | "jsx" };
      });
    },
  };
}

async function assertBuild(result: Bun.BuildOutput, label: string): Promise<void> {
  if (!result.success) {
    const details = result.logs.map((log) => log.message).join("\n");
    throw new MdxxError("BUNDLE_FAILED", `${label} bundle failed${details ? `: ${details}` : ""}`);
  }
}

export async function bundleDocument(
  documentPath: string,
  directory: string,
  dependencies?: BundleDependencies,
  assets?: EmittedAssets,
  generatedAssetDirectory?: string,
): Promise<RenderBundles> {
  const serverDirectory = join(directory, "server");
  await mkdir(serverDirectory, { recursive: true });
  const server = await Bun.build({
    entrypoints: ["mdxx-server-entry"],
    outdir: serverDirectory,
    naming: { entry: "[name].[ext]", asset: "[name].[ext]" },
    target: "bun",
    format: "esm",
    packages: "bundle",
    minify: false,
    define: { "process.env.NODE_ENV": '"production"' },
    sourcemap: "none",
    plugins: [entryPlugin("mdxx-server-entry", serverEntry(documentPath)), runtimePlugin(), dependencyPlugin(dependencies), assetPlugin(assets), mdxPlugin(assets?.references, assets?.urls)],
  });
  await assertBuild(server, "server");

  const client = await Bun.build({
    entrypoints: ["mdxx-client-entry"],
    target: "browser",
    format: "esm",
    packages: "bundle",
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
    sourcemap: "none",
    plugins: [entryPlugin("mdxx-client-entry", clientEntry(documentPath)), runtimePlugin(), dependencyPlugin(dependencies), assetPlugin(assets), mdxPlugin(assets?.references, assets?.urls)],
  });
  await assertBuild(client, "browser");

  const javascript = client.outputs.find((output) => output.path.endsWith(".js"));
  if (!javascript) throw new MdxxError("BUNDLE_FAILED", "browser bundle produced no JavaScript");
  const cssOutputs = client.outputs.filter((output) => output.path.endsWith(".css"));
  const generated = client.outputs.filter((output) => !output.path.endsWith(".js") && !output.path.endsWith(".css"));
  const rewrites = new Map<string, string>();
  if (generated.length > 0) {
    if (!generatedAssetDirectory) throw new MdxxError("BUNDLE_FAILED", "bundle emitted assets without an output directory");
    await mkdir(generatedAssetDirectory, { recursive: true });
    for (const output of generated) {
      const bytes = new Uint8Array(await output.arrayBuffer());
      const extension = extname(output.path).toLowerCase();
      const stem = basename(output.path, extension).replace(/-[A-Za-z0-9]+$/, "").replace(/[^A-Za-z0-9._-]+/g, "-") || "asset";
      const name = `${stem}.${sha256(bytes).slice(7, 23)}${extension}`;
      await Bun.write(join(generatedAssetDirectory, name), bytes);
      rewrites.set(basename(output.path), `assets/${name}`);
    }
  }
  const rewriteGenerated = (source: string): string => {
    let result = source.replaceAll("https://mdxx.invalid/", "");
    for (const [from, to] of rewrites) result = result.replaceAll(from, to);
    return result;
  };
  const css = await Promise.all(cssOutputs.map(async (output) => rewriteGenerated(await output.text())));

  const serverFiles = await readdir(serverDirectory);
  const serverFile = serverFiles.find((path) => path.endsWith(".js"));
  if (!serverFile) throw new MdxxError("BUNDLE_FAILED", "server bundle produced no JavaScript");
  return { serverPath: join(serverDirectory, serverFile), clientJavaScript: rewriteGenerated(await javascript.text()), css };
}
