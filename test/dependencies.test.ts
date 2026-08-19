import { expect, test } from "bun:test";
import { parseBunLock } from "../src/dependencies/bun-lock.ts";
import { join } from "node:path";
import { build } from "../src/commands/build.ts";
import { lock } from "../src/commands/lock.ts";

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
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);
