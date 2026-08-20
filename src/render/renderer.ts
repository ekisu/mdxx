import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleDocument } from "./bundle.ts";
import { createHtml } from "./html.ts";
import type { BundleDependencies } from "./bundle.ts";
import type { EmittedAssets } from "../assets/emit.ts";

export async function renderDocument(
  documentPath: string,
  metadata: Record<string, unknown>,
  dependencies: BundleDependencies,
  sourcePaths: string[],
  workerPaths: string[],
  assets?: EmittedAssets,
  generatedAssetDirectory?: string,
  features: string[] = [],
): Promise<string> {
  const temporary = await mkdtemp(join(tmpdir(), "mdxx-render-"));
  try {
    const manifest = await bundleDocument(documentPath, temporary, dependencies, sourcePaths, workerPaths, assets, generatedAssetDirectory, features);
    return createHtml({ metadata, scripts: manifest.scripts, styles: manifest.styles });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
