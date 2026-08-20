import { parseDocument } from "../document/parse.ts";
import { discoverImports } from "../imports/discover.ts";
import { readDocument } from "../shared/paths.ts";
import { discoverAssets } from "../assets/discover.ts";
import { currentTarget } from "../dependencies/resolve.ts";
import { reactRuntimeSupport } from "../render/runtime.ts";

export async function inspect(path: string): Promise<Record<string, unknown>> {
  const document = parseDocument(await readDocument(path));
  const graph = await discoverImports(path, document.body);
  const assets = await discoverAssets(path, document.body, graph);
  return {
    path,
    sourceDigest: document.sourceDigest,
    frontmatter: document.frontmatter,
    lock: document.lock
      ? {
          present: true,
          fresh: document.lockFresh,
          target: document.lock.target,
          resolver: document.lock.resolver,
          roots: document.lock.roots,
          packages: document.lock.packages,
        }
      : { present: false },
    imports: graph.imports,
    packages: graph.packages,
    assets: assets.files,
    styles: assets.styles,
    remoteUrls: assets.remoteUrls,
    client: {
      target: currentTarget(),
      react: document.lock?.react ?? reactRuntimeSupport,
      features: graph.features,
      browserAssets: [...assets.files, ...assets.styles],
      chunks: "emitted during build",
    },
  };
}
