import { expect, test } from "bun:test";
import { parseBunLock } from "../src/dependencies/bun-lock.ts";
import { join } from "node:path";
import { build } from "../src/commands/build.ts";
import { lock } from "../src/commands/lock.ts";
import { parseDocument } from "../src/document/parse.ts";
import { appendEmbeddedLock, type EmbeddedLock } from "../src/document/embedded-lock.ts";
import { verify } from "../src/commands/verify.ts";

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
    const htmlPath = await build(document, { output: join(directory, "output"), locked: true });
    expect(await Bun.file(htmlPath).text()).toContain("&amp;lt;locked&amp;gt;");

    const parsed = parseDocument(await Bun.file(document).text());
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
    const htmlPath = await build(document, { output: join(directory, "output") });
    expect(await Bun.file(htmlPath).text()).toContain("line-height:1.15");
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);
