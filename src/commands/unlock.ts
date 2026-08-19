import { extractEmbeddedLock } from "../document/embedded-lock.ts";
import { MdxxError } from "../shared/errors.ts";
import { atomicWrite, readDocument } from "../shared/paths.ts";

export async function unlock(path: string): Promise<void> {
  const extracted = extractEmbeddedLock(await readDocument(path));
  if (!extracted.lock) throw new MdxxError("NOT_LOCKED", "document has no embedded lock");
  await atomicWrite(path, extracted.source);
}
