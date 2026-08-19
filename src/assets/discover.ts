import { dirname, extname, resolve } from "node:path";
import type { ImportGraph } from "../imports/graph.ts";
import { MdxxError } from "../shared/errors.ts";

export interface AssetReference {
  importer: string;
  specifier: string;
  resolved?: string;
  remote: boolean;
}

export interface AssetDiscovery {
  references: AssetReference[];
  files: string[];
  styles: string[];
  remoteUrls: string[];
}

function staticUrls(source: string, extension: string): string[] {
  const values: string[] = [];
  const patterns = extension === ".css"
    ? [/@import\s+(?:url\()?\s*["']([^"']+)["']\s*\)?/g, /url\(\s*["']?([^"')]+)["']?\s*\)/g]
    : [/!\[[^\]]*\]\((?:<)?([^\s)>]+)(?:>)?(?:\s+["'][^"']*["'])?\)/g, /\b(?:src|poster)\s*=\s*["']([^"']+)["']/g];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match[1];
      if (value) values.push(value);
    }
  }
  return values;
}

function ignoredUrl(value: string): boolean {
  return value.startsWith("#") || value.startsWith("data:") || value.startsWith("/");
}

export async function discoverAssets(documentPath: string, mdxBody: string, graph: ImportGraph): Promise<AssetDiscovery> {
  const references: AssetReference[] = graph.imports
    .filter((item) => (item.kind === "asset" || item.kind === "style") && item.resolved)
    .map((item) => ({ importer: item.importer, specifier: item.specifier, resolved: item.resolved, remote: false }));
  const files = new Set(graph.assets);
  const styles = new Set(graph.styles);
  const pending = [resolve(documentPath), ...graph.modules.filter((path) => resolve(path) !== resolve(documentPath)), ...graph.styles];
  const visited = new Set<string>();
  const remoteUrls = new Set<string>();

  while (pending.length > 0) {
    const path = pending.shift();
    if (!path || visited.has(path)) continue;
    visited.add(path);
    const extension = extname(path).toLowerCase();
    const source = path === resolve(documentPath) ? mdxBody : await Bun.file(path).text();
    for (const specifier of staticUrls(source, extension)) {
      if (/^https?:\/\//.test(specifier)) {
        remoteUrls.add(specifier);
        references.push({ importer: path, specifier, remote: true });
        continue;
      }
      if (ignoredUrl(specifier)) continue;
      const resolved = resolve(dirname(path), specifier.split(/[?#]/, 1)[0] ?? specifier);
      if (!(await Bun.file(resolved).exists())) {
        throw new MdxxError("MISSING_LOCAL_ASSET", `cannot resolve asset ${specifier} from ${path}`);
      }
      references.push({ importer: path, specifier, resolved, remote: false });
      if (extname(resolved).toLowerCase() === ".css") {
        styles.add(resolved);
        pending.push(resolved);
      } else {
        files.add(resolved);
      }
    }
  }

  const sort = (a: string, b: string): number => a.localeCompare(b, "en");
  references.sort((a, b) => sort(`${a.importer}\0${a.specifier}`, `${b.importer}\0${b.specifier}`));
  return {
    references,
    files: [...files].sort(sort),
    styles: [...styles].sort(sort),
    remoteUrls: [...remoteUrls].sort(sort),
  };
}
