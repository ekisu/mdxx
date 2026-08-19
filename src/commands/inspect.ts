import { parseDocument } from "../document/parse.ts";
import { discoverImports } from "../imports/discover.ts";
import { readDocument } from "../shared/paths.ts";

export async function inspect(path: string): Promise<Record<string, unknown>> {
  const document = parseDocument(await readDocument(path));
  const graph = await discoverImports(path, document.body);
  return {
    path,
    sourceDigest: document.sourceDigest,
    frontmatter: document.frontmatter,
    lock: document.lock ? { present: true, fresh: document.lockFresh } : { present: false },
    imports: graph.imports,
    packages: graph.packages,
    assets: graph.assets,
    remoteUrls: graph.remoteUrls,
  };
}
