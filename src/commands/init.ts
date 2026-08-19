import { MdxxError } from "../shared/errors.ts";
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";

const INITIAL_DOCUMENT = `---
mdxx:
  format: 1
---

# Untitled
`;

export async function init(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  let file;
  try {
    file = await open(path, "wx");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "EEXIST") {
      throw new MdxxError("ALREADY_EXISTS", `refusing to overwrite ${path}`);
    }
    throw cause;
  }
  try {
    await file.writeFile(INITIAL_DOCUMENT);
  } finally {
    await file.close();
  }
}
