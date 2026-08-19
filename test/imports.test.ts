import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { discoverImports } from "../src/imports/discover.ts";
import { parsePackageSpecifier } from "../src/imports/specifier.ts";

describe("package specifiers", () => {
  test.each([
    ["react", "react", "latest", ""],
    ["pkg@1.2.3", "pkg", "1.2.3", ""],
    ["pkg@^2/subpath", "pkg", "^2", "/subpath"],
    ["@scope/pkg", "@scope/pkg", "latest", ""],
    ["@scope/pkg@next/subpath", "@scope/pkg", "next", "/subpath"],
  ])("parses %s", (input, name, selector, subpath) => {
    expect(parsePackageSpecifier(input)).toEqual({ original: input, name, selector, subpath });
  });
});

describe("import discovery", () => {
  test("walks relative TypeScript modules deterministically", async () => {
    await using directory = await Bun.$`mktemp -d`.text().then((path) => new AsyncDisposableDirectory(path.trim()));
    const document = join(directory.path, "document.mdx");
    await Bun.write(join(directory.path, "component.tsx"), "export {x} from './value.ts'; export const Component = () => <div />;");
    await Bun.write(join(directory.path, "value.ts"), "export const x: number = 1;");
    const graph = await discoverImports(document, "import {Component} from './component.tsx'\nimport React from 'react@^19'\n\n<Component />");
    expect(graph.modules.map((path) => path.slice(directory.path.length + 1))).toEqual(["component.tsx", "document.mdx", "value.ts"]);
    expect(graph.packages).toEqual([{ original: "react@^19", name: "react", selector: "^19", subpath: "" }]);
  });

  test("rejects forbidden imports", async () => {
    expect(discoverImports("document.mdx", "import fs from 'node:fs'\n\n# no")).rejects.toThrow("built-in import");
    expect(discoverImports("document.mdx", "export const x = import('./x.ts')\n\n# no")).rejects.toThrow("dynamic imports");
    expect(discoverImports("document.mdx", "import x from 'https://example.test/x.js'\n\n# no")).rejects.toThrow("remote code");
  });
});

class AsyncDisposableDirectory implements AsyncDisposable {
  constructor(readonly path: string) {}
  async [Symbol.asyncDispose](): Promise<void> {
    await Bun.$`rm -rf ${this.path}`;
  }
}
