import type { PackageSpecifier } from "./specifier.ts";

export interface ImportReference {
  importer: string;
  specifier: string;
  kind: "package" | "module" | "worker" | "asset" | "style" | "remote-asset";
  resolved?: string;
}

export interface ImportGraph {
  modules: string[];
  packages: PackageSpecifier[];
  imports: ImportReference[];
  assets: string[];
  styles: string[];
  remoteUrls: string[];
}
