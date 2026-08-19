import { MdxxError } from "../shared/errors.ts";

const INITIAL_DOCUMENT = `---
mdxx:
  format: 1
---

# Untitled
`;

export async function init(path: string): Promise<void> {
  if (await Bun.file(path).exists()) throw new MdxxError("ALREADY_EXISTS", `refusing to overwrite ${path}`);
  await Bun.write(path, INITIAL_DOCUMENT, { createPath: true });
}
