import { builtinModules } from "node:module";
import { MdxxError } from "../shared/errors.ts";

export interface PackageSpecifier {
  original: string;
  name: string;
  selector: string;
  subpath: string;
}

const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

export function isBuiltinSpecifier(specifier: string): boolean {
  return BUILTINS.has(specifier) || specifier.startsWith("bun:");
}

export function parsePackageSpecifier(original: string): PackageSpecifier {
  if (original.startsWith(".") || original.startsWith("/") || original.includes(":")) {
    throw new MdxxError("INVALID_PACKAGE", `not a bare package specifier: ${original}`);
  }

  let nameEnd: number;
  if (original.startsWith("@")) {
    const scopeSlash = original.indexOf("/");
    if (scopeSlash < 2) throw new MdxxError("INVALID_PACKAGE", `invalid scoped package: ${original}`);
    const selectorAt = original.indexOf("@", scopeSlash);
    const subpathSlash = original.indexOf("/", scopeSlash + 1);
    const packageEnd = [selectorAt, subpathSlash].filter((index) => index >= 0).sort((a, b) => a - b)[0];
    nameEnd = packageEnd ?? original.length;
  } else {
    const selectorAt = original.indexOf("@");
    const subpathSlash = original.indexOf("/");
    const packageEnd = [selectorAt, subpathSlash].filter((index) => index >= 0).sort((a, b) => a - b)[0];
    nameEnd = packageEnd ?? original.length;
  }

  const name = original.slice(0, nameEnd);
  if (!name || name === "@" || name.endsWith("/")) {
    throw new MdxxError("INVALID_PACKAGE", `invalid package name: ${original}`);
  }

  let cursor = nameEnd;
  let selector = "latest";
  if (original[cursor] === "@") {
    const selectorEnd = original.indexOf("/", cursor + 1);
    selector = original.slice(cursor + 1, selectorEnd < 0 ? undefined : selectorEnd);
    if (!selector) throw new MdxxError("INVALID_PACKAGE", `empty package selector: ${original}`);
    cursor = selectorEnd < 0 ? original.length : selectorEnd;
  }
  const subpath = original.slice(cursor);
  return { original, name, selector, subpath };
}
