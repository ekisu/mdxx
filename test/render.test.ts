import { expect, test } from "bun:test";
import { join } from "node:path";
import { build } from "../src/commands/build.ts";

test("builds deterministic server-rendered and hydratable HTML", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const document = join(directory, "hello.mdx");
  const source = `---
title: Render test
mdxx:
  format: 1
---

export function Greeting({name}) { return <strong>Hello {name}</strong> }

# Heading

<Greeting name="world" />
`;
  try {
    await Bun.write(document, source);
    const firstPath = await build(document, { output: join(directory, "first") });
    const secondPath = await build(document, { output: join(directory, "second") });
    const first = await Bun.file(firstPath).text();
    const second = await Bun.file(secondPath).text();
    expect(first).toBe(second);
    expect(first).toContain("<h1>Heading</h1>");
    expect(first).toContain("<strong>Hello <!-- -->world</strong>");
    expect(first).toContain('<script type="module">');
    expect(first).not.toContain(directory);
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);
