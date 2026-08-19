import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { MdxxError } from "../shared/errors.ts";
import { clientEntry } from "./client-entry.ts";
import { mdxPlugin } from "./compile.ts";
import { serverEntry } from "./server-entry.ts";

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
      builder.onResolve({ filter: /^[^.\/]|^@/ }, ({ path }) => {
        const mapped = dependencies.mappings.get(path) ?? path;
        try {
          return { path: Bun.resolveSync(mapped, dependencies.directory) };
        } catch {
          return undefined;
        }
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
): Promise<RenderBundles> {
  const serverDirectory = join(directory, "server");
  await mkdir(serverDirectory, { recursive: true });
  const server = await Bun.build({
    entrypoints: ["mdxx-server-entry"],
    outdir: serverDirectory,
    naming: "server.js",
    target: "bun",
    format: "esm",
    packages: "bundle",
    minify: false,
    sourcemap: "none",
    plugins: [entryPlugin("mdxx-server-entry", serverEntry(documentPath)), runtimePlugin(), dependencyPlugin(dependencies), mdxPlugin()],
  });
  await assertBuild(server, "server");

  const client = await Bun.build({
    entrypoints: ["mdxx-client-entry"],
    target: "browser",
    format: "esm",
    packages: "bundle",
    minify: true,
    sourcemap: "none",
    plugins: [entryPlugin("mdxx-client-entry", clientEntry(documentPath)), runtimePlugin(), dependencyPlugin(dependencies), mdxPlugin()],
  });
  await assertBuild(client, "browser");

  const javascript = client.outputs.find((output) => output.path.endsWith(".js"));
  if (!javascript) throw new MdxxError("BUNDLE_FAILED", "browser bundle produced no JavaScript");
  const cssOutputs = client.outputs.filter((output) => output.path.endsWith(".css"));
  const css = await Promise.all(cssOutputs.map((output) => output.text()));

  const serverFiles = await readdir(serverDirectory);
  const serverFile = serverFiles.find((path) => path.endsWith(".js"));
  if (!serverFile) throw new MdxxError("BUNDLE_FAILED", "server bundle produced no JavaScript");
  return { serverPath: join(serverDirectory, serverFile), clientJavaScript: await javascript.text(), css };
}
