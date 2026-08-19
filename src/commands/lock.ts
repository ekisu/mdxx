import { appendEmbeddedLock } from "../document/embedded-lock.ts";
import { parseDocument } from "../document/parse.ts";
import { prepareDependencies } from "../dependencies/resolve.ts";
import { discoverImports } from "../imports/discover.ts";
import { atomicWriteIfUnchanged, readDocument } from "../shared/paths.ts";

export async function lock(path: string): Promise<void> {
  const input = await readDocument(path);
  const document = parseDocument(input);
  const graph = await discoverImports(path, document.body);
  const prepared = await prepareDependencies(graph.packages);
  try {
    await atomicWriteIfUnchanged(path, input, appendEmbeddedLock(document.source, { sourceDigest: document.sourceDigest, ...prepared.lock }));
  } finally {
    await prepared.environment.dispose();
  }
}
