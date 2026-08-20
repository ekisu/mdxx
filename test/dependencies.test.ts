import { expect, test } from "bun:test";
import { parseBunLock } from "../src/dependencies/bun-lock.ts";
import { join } from "node:path";
import { build } from "../src/commands/build.ts";
import { lock } from "../src/commands/lock.ts";
import { parseDocument } from "../src/document/parse.ts";
import { appendEmbeddedLock, type EmbeddedLock } from "../src/document/embedded-lock.ts";
import { verify } from "../src/commands/verify.ts";
import { prepareDependencies, selectReactRuntime } from "../src/dependencies/resolve.ts";
import type { ResolvedPackage } from "../src/dependencies/bun-lock.ts";
import { parsePackageSpecifier } from "../src/imports/specifier.ts";

test("parses Bun package tuples into a stable internal graph", () => {
  const packages = parseBunLock(`{
    "lockfileVersion": 1,
    "packages": {
      "chalk": ["chalk@4.1.2", "", {"dependencies": {"ansi-styles": "^4.1.0"}}, "sha512-test"],
    },
  }`);
  expect(packages).toEqual([
    {
      locator: "chalk",
      name: "chalk",
      version: "4.1.2",
      resolution: "npm:chalk@4.1.2",
      integrity: "sha512-test",
      dependencies: { "ansi-styles": "^4.1.0" },
      optionalDependencies: {},
      peerDependencies: {},
      optionalPeers: [],
    },
  ]);
});

test("negotiates one exact React runtime from transitive constraints", () => {
  const packageEntry = (name: string, version: string, dependencies: Record<string, string> = {}): ResolvedPackage => ({
    locator: `${name}@${version}`,
    name,
    version,
    resolution: `npm:${name}@${version}`,
    integrity: "sha512-test",
    dependencies,
    optionalDependencies: {},
    peerDependencies: {},
    optionalPeers: [],
  });
  const packages = [
    packageEntry("react", "19.2.7"),
    packageEntry("react", "19.2.8"),
    packageEntry("react-dom", "19.2.7"),
    packageEntry("react-dom", "19.2.8"),
    packageEntry("component-library", "1.0.0", { react: "19.2.7", "react-dom": "19.2.7" }),
  ];
  expect(selectReactRuntime(packages)).toEqual({ react: "19.2.7", reactDom: "19.2.7" });
});

test("locks and renders an exact package selector", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const document = join(directory, "package.mdx");
  try {
    await Bun.write(
      document,
      `---
mdxx:
  format: 1
---

import escape from 'escape-html@1.0.3'

{escape("<locked>")}
`,
    );
    await lock(document);
    await build(document, { output: join(directory, "output"), locked: true });
    const entry = (await Array.fromAsync(new Bun.Glob("assets/client-*.js").scan({ cwd: join(directory, "output") })))[0];
    expect(entry).toBeDefined();
    expect(await Bun.file(join(directory, "output", entry!)).text()).toContain('"<locked>"');

    const parsed = parseDocument(await Bun.file(document).text());
    const runtime = parsed.lock?.react as { react?: string; reactDom?: string };
    expect(runtime.react).toBe(runtime.reactDom);
    expect(runtime.react).toMatch(/^19\.2\./);
    expect(parsed.lock?.runtimePolicy).toEqual({ name: "react", strategy: "negotiated-singleton-override", version: 1 });
    expect(parsed.lock?.features).toEqual([]);
    expect(Array.isArray(parsed.lock?.peers)).toBe(true);
    const tampered = structuredClone(parsed.lock) as EmbeddedLock;
    const firstPackage = (tampered.packages as Array<Record<string, unknown>>)[0];
    if (!firstPackage) throw new Error("expected a locked package");
    firstPackage.resolution = "npm:tampered@0.0.0";
    await Bun.write(document, appendEmbeddedLock(parsed.source, tampered));
    await expect(verify(document)).rejects.toThrow("installed dependency graph does not match");
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);

test("processes CSS from a versioned package subpath", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const document = join(directory, "package-css.mdx");
  try {
    await Bun.write(
      document,
      "---\nmdxx:\n  format: 1\n---\n\nimport 'normalize.css@8.0.1/normalize.css'\n\n# Styled\n",
    );
    await build(document, { output: join(directory, "output") });
    const css = (await Array.fromAsync(new Bun.Glob("assets/*.css").scan({ cwd: join(directory, "output") })))[0];
    expect(css).toBeDefined();
    expect(await Bun.file(join(directory, "output", css!)).text()).toContain("line-height:1.15");
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);

test("verify rejects a locked package subpath that the browser cannot resolve", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const document = join(directory, "missing-export.mdx");
  try {
    await Bun.write(
      document,
      "---\nmdxx:\n  format: 1\n---\n\nimport 'escape-html@1.0.3/missing-export'\n\n# Missing export\n",
    );
    await lock(document);
    await expect(verify(document)).rejects.toThrow(
      "escape-html@1.0.3/missing-export (escape-html@1.0.3) is not available for the browser/import/default conditions",
    );
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);

test("rejects package peers incompatible with the selected React runtime", async () => {
  await expect(prepareDependencies([parsePackageSpecifier("react-test-renderer@16.14.0")])).rejects.toThrow(
    "react-test-renderer@16.14.0 peer requires react ^16.14.0",
  );
}, 30_000);
