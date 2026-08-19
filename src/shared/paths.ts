import { dirname, extname, resolve } from "node:path";
import { MdxxError } from "./errors.ts";
import { stat } from "node:fs/promises";

export async function readDocument(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new MdxxError("NOT_FOUND", `document does not exist: ${path}`);
  return file.text();
}

export async function atomicWrite(path: string, contents: string | Uint8Array): Promise<void> {
  const temporary = `${path}.mdxx-${process.pid}-${crypto.randomUUID()}.tmp`;
  try {
    await Bun.write(temporary, contents);
    await Bun.file(temporary).exists();
    await import("node:fs/promises").then(({ rename }) => rename(temporary, path));
  } catch (error) {
    await import("node:fs/promises").then(({ rm }) => rm(temporary, { force: true }));
    throw error;
  }
}

export async function atomicWriteIfUnchanged(path: string, expected: string, contents: string): Promise<void> {
  if (await readDocument(path) !== expected) {
    throw new MdxxError("CONCURRENT_MODIFICATION", `document changed while the command was running: ${path}`);
  }
  await atomicWrite(path, contents);
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

const MODULE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".json"];

export async function resolveLocalModule(fromPath: string, specifier: string): Promise<string | undefined> {
  const base = resolve(dirname(fromPath), specifier);
  for (const extension of MODULE_EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (await Bun.file(candidate).exists()) return candidate;
  }
  for (const extension of MODULE_EXTENSIONS.slice(1)) {
    const candidate = resolve(base, `index${extension}`);
    if (await Bun.file(candidate).exists()) return candidate;
  }
  return undefined;
}

export function isCodePath(path: string): boolean {
  return [".mdx", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".json"].includes(extname(path).toLowerCase());
}
