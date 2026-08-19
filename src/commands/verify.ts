import { parseDocument } from "../document/parse.ts";
import { discoverImports } from "../imports/discover.ts";
import { MdxxError } from "../shared/errors.ts";
import { readDocument } from "../shared/paths.ts";

export async function verify(path: string): Promise<void> {
  const document = parseDocument(await readDocument(path));
  if (document.lock && !document.lockFresh) {
    throw new MdxxError("STALE_LOCK", "embedded lock does not match the document source");
  }
  await discoverImports(path, document.body);
}
