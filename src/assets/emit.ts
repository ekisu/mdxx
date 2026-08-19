import { mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { sha256 } from "../shared/digest.ts";
import type { AssetDiscovery } from "./discover.ts";

export interface EmittedAssets {
  urls: Map<string, string>;
  references: AssetDiscovery["references"];
}

function outputName(path: string, digest: string, length = 16): string {
  const extension = extname(path);
  const stem = basename(path, extension).replace(/[^A-Za-z0-9._-]+/g, "-") || "asset";
  return `${stem}.${digest.slice("sha256-".length, "sha256-".length + length)}${extension.toLowerCase()}`;
}

export async function emitAssets(discovery: AssetDiscovery, outputDirectory: string): Promise<EmittedAssets> {
  const candidates: Array<{ path: string; bytes: Uint8Array; digest: string }> = [];
  for (const path of discovery.files) {
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    candidates.push({ path, bytes, digest: sha256(bytes) });
  }
  candidates.sort((a, b) => `${a.digest}\0${a.path}`.localeCompare(`${b.digest}\0${b.path}`, "en"));

  const names = new Map<string, string>();
  const usedNames = new Map<string, string>();
  const urls = new Map<string, string>();
  if (candidates.length > 0) await mkdir(outputDirectory, { recursive: true });
  for (const candidate of candidates) {
    let name = names.get(candidate.digest);
    if (!name) {
      let length = 16;
      name = outputName(candidate.path, candidate.digest, length);
      while (usedNames.has(name) && usedNames.get(name) !== candidate.digest) {
        length += 4;
        name = outputName(candidate.path, candidate.digest, length);
      }
      names.set(candidate.digest, name);
      usedNames.set(name, candidate.digest);
      await Bun.write(join(outputDirectory, name), candidate.bytes);
    }
    urls.set(candidate.path, `assets/${name}`);
  }
  return { urls, references: discovery.references };
}
