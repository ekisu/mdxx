import { parseDocument } from "../document/parse.ts";
import { discoverImports } from "../imports/discover.ts";
import { MdxxError } from "../shared/errors.ts";
import { readDocument } from "../shared/paths.ts";
import { prepareDependencies } from "../dependencies/resolve.ts";
import { discoverAssets } from "../assets/discover.ts";

export async function verify(path: string): Promise<void> {
  const document = parseDocument(await readDocument(path));
  if (document.lock && !document.lockFresh) {
    throw new MdxxError("STALE_LOCK", "embedded lock does not match the document source");
  }
  const graph = await discoverImports(path, document.body);
  await discoverAssets(path, document.body, graph);
  if (document.lock) {
    const prepared = await prepareDependencies(graph.packages, document.lock);
    await prepared.environment.dispose();
  }
}
