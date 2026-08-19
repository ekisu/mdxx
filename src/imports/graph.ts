import type { PackageSpecifier } from "./specifier.ts";

export interface ImportReference {
  importer: string;
  specifier: string;
  kind: "package" | "module" | "asset" | "remote-asset";
  resolved?: string;
}

export interface ImportGraph {
  modules: string[];
  packages: PackageSpecifier[];
  imports: ImportReference[];
  assets: string[];
  remoteUrls: string[];
}
