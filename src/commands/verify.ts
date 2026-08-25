import { parseDocument } from "../document/parse.ts";
import { discoverImports } from "../imports/discover.ts";
import { MdxxError } from "../shared/errors.ts";
import { readDocument } from "../shared/paths.ts";
import { prepareDependencies, verifyPackageImports, type LockedRoot } from "../dependencies/resolve.ts";
import { discoverAssets } from "../assets/discover.ts";

export async function verify(path: string): Promise<void> {
  const document = parseDocument(await readDocument(path));
  if (document.lock && !document.lockFresh) {
    throw new MdxxError("STALE_LOCK", "embedded lock does not match the document source", {
      help: `Run \`mdxx lock ${path}\` to refresh it, or \`mdxx unlock ${path}\` to remove it.`,
    });
  }
  const graph = await discoverImports(path, document.body, document);
  await discoverAssets(path, document.body, graph);
  if (document.lock) {
    const prepared = await prepareDependencies(graph.packages, document.lock, graph.features);
    try {
      await verifyPackageImports(graph.packages, prepared.environment, prepared.lock.roots as LockedRoot[]);
    } finally {
      await prepared.environment.dispose();
    }
  }
}
