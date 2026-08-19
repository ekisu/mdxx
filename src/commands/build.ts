import { mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseDocument } from "../document/parse.ts";
import { discoverImports } from "../imports/discover.ts";
import { prepareDependencies } from "../dependencies/resolve.ts";
import { renderDocument } from "../render/renderer.ts";
import { MdxxError } from "../shared/errors.ts";
import { pathExists, readDocument } from "../shared/paths.ts";
import { discoverAssets } from "../assets/discover.ts";
import { emitAssets } from "../assets/emit.ts";
import { containsMermaid } from "../render/mermaid.ts";

export interface BuildOptions {
  output: string;
  locked?: boolean;
  onWarning?: (message: string) => void;
}

export async function build(path: string, options: BuildOptions): Promise<string> {
  const documentPath = resolve(path);
  const output = resolve(options.output);
  if (await pathExists(output)) throw new MdxxError("OUTPUT_EXISTS", `output path already exists: ${options.output}`);

  const document = parseDocument(await readDocument(documentPath));
  if (document.lock && !document.lockFresh) throw new MdxxError("STALE_LOCK", "embedded lock does not match the document source");
  if (options.locked && !document.lock) throw new MdxxError("LOCK_REQUIRED", "--locked requires a current embedded lock");
  const graph = await discoverImports(documentPath, document.body);
  const assets = await discoverAssets(documentPath, document.body, graph);
  for (const url of assets.remoteUrls) (options.onWarning ?? console.warn)(`mdxx: remote asset is mutable: ${url}`);

  const prepared = await prepareDependencies(graph.packages, document.lock);

  const parent = dirname(output);
  const staging = join(parent, `.mdxx-${basename(output)}-${crypto.randomUUID()}`);
  try {
    await mkdir(parent, { recursive: true });
    await mkdir(staging);
    const emitted = await emitAssets(assets, join(staging, "assets"));
    const html = await renderDocument(
      documentPath,
      document.metadata,
      prepared.environment,
      emitted,
      join(staging, "assets"),
      containsMermaid(document.body),
    );
    const name = basename(documentPath, extname(documentPath));
    await Bun.write(join(staging, `${name}.html`), html);
    await rename(staging, output);
    return join(output, `${name}.html`);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  } finally {
    await prepared.environment.dispose();
  }
}
