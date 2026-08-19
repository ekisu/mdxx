import { appendEmbeddedLock } from "../document/embedded-lock.ts";
import { parseDocument } from "../document/parse.ts";
import { prepareDependencies } from "../dependencies/resolve.ts";
import { discoverImports } from "../imports/discover.ts";
import { atomicWrite, readDocument } from "../shared/paths.ts";

export async function lock(path: string): Promise<void> {
  const document = parseDocument(await readDocument(path));
  const graph = await discoverImports(path, document.body);
  const prepared = await prepareDependencies(graph.packages);
  try {
    await atomicWrite(path, appendEmbeddedLock(document.source, { sourceDigest: document.sourceDigest, ...prepared.lock }));
  } finally {
    await prepared.environment.dispose();
  }
}
