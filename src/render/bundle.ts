import { copyFile, mkdir } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { MdxxError } from "../shared/errors.ts";
import { clientEntry } from "./client-entry.ts";
import { mdxPlugin } from "./compile.ts";
import type { EmittedAssets } from "../assets/emit.ts";
import { sha256 } from "../shared/digest.ts";
import { BROWSER_CONDITIONS } from "./runtime.ts";

export interface BrowserArtifact {
  path: string;
  kind: Bun.BuildArtifact["kind"];
  loader: Bun.Loader;
}

export interface BrowserManifest {
  artifacts: BrowserArtifact[];
  scripts: string[];
  styles: string[];
}

export interface BundleDependencies {
  directory: string;
  mappings: Map<string, string>;
}

function normalizeImports(source: string, mappings: Map<string, string>): string {
  let result = source;
  for (const [authored, runtime] of mappings) {
    result = result.replaceAll(JSON.stringify(authored), JSON.stringify(runtime));
    result = result.replaceAll(`'${authored}'`, `'${runtime}'`);
  }
  return result;
}

function commonDirectory(paths: string[]): string {
  let directory = dirname(resolve(paths[0] ?? "."));
  while (paths.some((path) => relative(directory, resolve(path)).startsWith(".."))) {
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return directory;
}

async function createCapsuleSources(
  documentPath: string,
  sourcePaths: string[],
  dependencies: BundleDependencies,
  assets?: EmittedAssets,
): Promise<{ documentPath: string; copies: Map<string, string>; assets?: EmittedAssets }> {
  const sources = [...new Set([documentPath, ...sourcePaths].map((path) => resolve(path)))].sort((a, b) => a.localeCompare(b, "en"));
  const sourceRoot = commonDirectory(sources);
  const copies = new Map<string, string>();

  for (const source of sources) {
    const destination = join(dependencies.directory, "source", relative(sourceRoot, source));
    await mkdir(dirname(destination), { recursive: true });
    const extension = source.slice(source.lastIndexOf(".")).toLowerCase();
    if ([".mdx", ".js", ".jsx", ".mjs", ".ts", ".tsx", ".mts"].includes(extension)) {
      await Bun.write(destination, normalizeImports(await Bun.file(source).text(), dependencies.mappings));
    } else {
      await copyFile(source, destination);
    }
    copies.set(source, destination);
  }

  const copiedAssets = assets && {
    urls: assets.urls,
    references: assets.references.map((reference) => ({
      ...reference,
      importer: copies.get(resolve(reference.importer)) ?? reference.importer,
    })),
  };
  const copiedDocument = copies.get(resolve(documentPath));
  if (!copiedDocument) throw new MdxxError("BUNDLE_FAILED", "document was not copied into the application capsule");
  return { documentPath: copiedDocument, copies, assets: copiedAssets };
}

function assetPlugin(assets?: EmittedAssets): Bun.BunPlugin {
  return {
    name: "mdxx-assets",
    setup(builder) {
      if (!assets) return;
      builder.onResolve({ filter: /^https:\/\/mdxx\.invalid\// }, ({ path }) => ({ path, external: true }));
      const specifiers = [...new Set(assets.references.filter((item) => item.resolved && assets.urls.has(item.resolved)).map((item) => item.specifier))];
      if (specifiers.length > 0) {
        const escaped = specifiers.map((specifier) => specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        // Broad fallthrough hooks can drop live bindings: https://github.com/oven-sh/bun/issues/29445
        builder.onResolve({ filter: new RegExp(`^(?:${escaped.join("|")})$`) }, ({ path, importer }) => {
          const reference = assets.references.find((item) => item.importer === importer && item.specifier === path && item.resolved);
          if (!reference?.resolved || !assets.urls.has(reference.resolved)) return undefined;
          return { path: reference.resolved, namespace: "mdxx-asset" };
        });
      }
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
          if (url) contents = contents.replaceAll(reference.specifier, css ? `https://mdxx.invalid/${basename(url)}` : url);
        }
        const extension = path.slice(path.lastIndexOf(".") + 1);
        return { contents, loader: extension as "css" | "ts" | "tsx" | "js" | "jsx" };
      });
    },
  };
}

function assertBuild(result: Bun.BuildOutput): void {
  if (result.success) return;
  const details = result.logs.map((log) => log.message).join("\n");
  throw new MdxxError("BUNDLE_FAILED", `browser bundle failed${details ? `: ${details}` : ""}`);
}

export async function bundleDocument(
  documentPath: string,
  directory: string,
  dependencies: BundleDependencies,
  sourcePaths: string[],
  workerPaths: string[],
  assets?: EmittedAssets,
  outputDirectory?: string,
  features: string[] = [],
): Promise<BrowserManifest> {
  if (!outputDirectory) throw new MdxxError("BUNDLE_FAILED", "browser bundle has no output directory");
  const capsule = await createCapsuleSources(documentPath, sourcePaths, dependencies, assets);
  const entryDirectory = join(dependencies.directory, "entries");
  const buildDirectory = join(directory, "browser");
  await mkdir(entryDirectory, { recursive: true });
  await mkdir(buildDirectory, { recursive: true });
  const entryPath = join(entryDirectory, "client.tsx");
  await Bun.write(entryPath, clientEntry(relative(entryDirectory, capsule.documentPath).replaceAll("\\", "/").replace(/^(?!\.)/, "./"), features));

  const result = await Bun.build({
    entrypoints: [entryPath, ...workerPaths.map((path) => capsule.copies.get(resolve(path))).filter((path): path is string => path !== undefined)],
    outdir: buildDirectory,
    root: dependencies.directory,
    target: "browser",
    format: "esm",
    splitting: true,
    packages: "bundle",
    naming: { entry: "[name]-[hash].[ext]", chunk: "chunk-[hash].[ext]", asset: "[name]-[hash].[ext]" },
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
    env: "disable",
    sourcemap: "none",
    allowUnresolved: [],
    conditions: BROWSER_CONDITIONS,
    plugins: [assetPlugin(capsule.assets), mdxPlugin(capsule.assets?.references, capsule.assets?.urls)],
    throw: false,
  });
  assertBuild(result);

  const outputs = [...result.outputs].sort((a, b) => basename(a.path).localeCompare(basename(b.path), "en"));
  const originalNames = outputs.map((output) => basename(output.path));
  const contents = await Promise.all(outputs.map(async (output) => new Uint8Array(await output.arrayBuffer())));
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const workerOutputs = new Map<string, string>();
  for (const workerPath of workerPaths) {
    const stem = basename(workerPath, extname(workerPath));
    const output = originalNames.find((name) => name.startsWith(`${stem}-`) && name.endsWith(".js"));
    if (output) workerOutputs.set(`./${basename(workerPath)}`, output);
  }
  const linkWorkers = (source: string): string => {
    let linked = source;
    for (const [specifier, output] of workerOutputs) linked = linked.replaceAll(specifier, output);
    return linked;
  };
  const normalized = contents.map((bytes, index) => {
    if (!originalNames[index]?.match(/\.(?:css|js)$/)) return bytes;
    let source = linkWorkers(decoder.decode(bytes)).replaceAll("https://mdxx.invalid/", "");
    for (const [outputIndex, name] of originalNames.entries()) source = source.replaceAll(name, `__MDXX_OUTPUT_${outputIndex}__`);
    return encoder.encode(source);
  });
  const finalNames = outputs.map((_, index) => {
    const original = originalNames[index] ?? "asset";
    const extension = extname(original).toLowerCase();
    const stem = basename(original, extension).replace(/-[a-z0-9]{8}$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-") || "asset";
    return `${stem}-${sha256(normalized[index]!).slice(7, 23)}${extension}`;
  });

  await mkdir(outputDirectory, { recursive: true });
  const artifacts: BrowserArtifact[] = [];
  for (const [index, output] of outputs.entries()) {
    let bytes = contents[index]!;
    if (originalNames[index]?.match(/\.(?:css|js)$/)) {
      let source = linkWorkers(decoder.decode(bytes)).replaceAll("https://mdxx.invalid/", "");
      for (const [outputIndex, name] of originalNames.entries()) source = source.replaceAll(name, finalNames[outputIndex]!);
      bytes = encoder.encode(source);
    }
    const name = finalNames[index]!;
    await Bun.write(join(outputDirectory, name), bytes);
    artifacts.push({ path: `assets/${name}`, kind: output.kind, loader: output.loader });
  }
  const runtimeScripts: string[] = [];
  if (features.includes("mermaid")) {
    const standalonePath = join(dependencies.directory, "node_modules", "mermaid", "dist", "mermaid.min.js");
    const header = '"use strict";var __esbuild_esm_mermaid_nm;';
    const standalone = await Bun.file(standalonePath).text();
    if (!standalone.startsWith(header)) throw new MdxxError("BUNDLE_FAILED", "unsupported Mermaid standalone bundle format");
    const source = standalone.replace(header, '"use strict";var __esbuild_esm_mermaid_nm=globalThis.__esbuild_esm_mermaid_nm={};');
    const name = `mermaid-${sha256(source).slice(7, 23)}.js`;
    await Bun.write(join(outputDirectory, name), source);
    const path = `assets/${name}`;
    runtimeScripts.push(path);
    artifacts.push({ path, kind: "entry-point", loader: "js" });
  }
  const clientScripts = artifacts.filter((item) => item.kind === "entry-point" && item.path.startsWith("assets/client-") && item.path.endsWith(".js")).map((item) => item.path);
  const scripts = [...runtimeScripts, ...clientScripts];
  if (scripts.length === 0) throw new MdxxError("BUNDLE_FAILED", "browser bundle produced no JavaScript entry");
  const styles = artifacts.filter((item) => item.path.endsWith(".css")).map((item) => item.path);
  return { artifacts, scripts, styles };
}
