import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleDocument } from "./bundle.ts";
import { createHtml } from "./html.ts";
import { renderInWorker } from "./worker.ts";

export async function renderDocument(documentPath: string, metadata: Record<string, unknown>): Promise<string> {
  const temporary = await mkdtemp(join(tmpdir(), "mdxx-render-"));
  try {
    const bundles = await bundleDocument(documentPath, temporary);
    const markup = await renderInWorker(bundles.serverPath, metadata);
    return createHtml({ markup, metadata, clientJavaScript: bundles.clientJavaScript, css: bundles.css });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
