import { extractEmbeddedLock } from "../document/embedded-lock.ts";
import { MdxxError } from "../shared/errors.ts";
import { atomicWriteIfUnchanged, readDocument } from "../shared/paths.ts";

export async function unlock(path: string): Promise<void> {
  const input = await readDocument(path);
  const extracted = extractEmbeddedLock(input);
  if (!extracted.lock) throw new MdxxError("NOT_LOCKED", "document has no embedded lock");
  await atomicWriteIfUnchanged(path, input, extracted.source);
}
