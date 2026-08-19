import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleDocument } from "./bundle.ts";
import { createHtml } from "./html.ts";
import { renderInWorker } from "./worker.ts";
import type { BundleDependencies } from "./bundle.ts";
import type { EmittedAssets } from "../assets/emit.ts";
import { MdxxError } from "../shared/errors.ts";

export async function renderDocument(
  documentPath: string,
  metadata: Record<string, unknown>,
  dependencies?: BundleDependencies,
  assets?: EmittedAssets,
  generatedAssetDirectory?: string,
  mermaid = false,
): Promise<string> {
  const temporary = await mkdtemp(join(tmpdir(), "mdxx-render-"));
  try {
    const bundles = await bundleDocument(documentPath, temporary, dependencies, assets, generatedAssetDirectory, mermaid);
    const markup = await renderInWorker(bundles.serverPath, metadata);
    const repeatedMarkup = await renderInWorker(bundles.serverPath, metadata);
    if (markup !== repeatedMarkup) {
      throw new MdxxError("NONDETERMINISTIC_RENDER", "document produced different markup in repeated isolated renders");
    }
    return createHtml({ markup, metadata, clientJavaScript: bundles.clientJavaScript, css: bundles.css });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
