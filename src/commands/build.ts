import { mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseDocument } from "../document/parse.ts";
import { discoverImports } from "../imports/discover.ts";
import { renderDocument } from "../render/renderer.ts";
import { MdxxError } from "../shared/errors.ts";
import { readDocument } from "../shared/paths.ts";

export interface BuildOptions {
  output: string;
  locked?: boolean;
}

export async function build(path: string, options: BuildOptions): Promise<string> {
  const documentPath = resolve(path);
  const output = resolve(options.output);
  if (await Bun.file(output).exists()) throw new MdxxError("OUTPUT_EXISTS", `output path already exists: ${options.output}`);

  const document = parseDocument(await readDocument(documentPath));
  if (document.lock && !document.lockFresh) throw new MdxxError("STALE_LOCK", "embedded lock does not match the document source");
  if (options.locked && !document.lock) throw new MdxxError("LOCK_REQUIRED", "--locked requires a current embedded lock");
  const graph = await discoverImports(documentPath, document.body);
  if (graph.packages.length > 0) {
    throw new MdxxError("PACKAGES_PENDING", "package imports require dependency resolution support");
  }
  if (graph.assets.length > 0) throw new MdxxError("ASSETS_PENDING", "asset imports require asset processing support");

  const parent = dirname(output);
  await mkdir(parent, { recursive: true });
  const staging = join(parent, `.mdxx-${basename(output)}-${crypto.randomUUID()}`);
  try {
    await mkdir(staging);
    const html = await renderDocument(documentPath, document.metadata);
    const name = basename(documentPath, extname(documentPath));
    await Bun.write(join(staging, `${name}.html`), html);
    await rename(staging, output);
    return join(output, `${name}.html`);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
