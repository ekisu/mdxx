import { expect, test } from "bun:test";
import { join } from "node:path";
import { build } from "../src/commands/build.ts";
import { renderInWorker } from "../src/render/worker.ts";

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

test("times out a stuck render subprocess", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const worker = join(directory, "stuck.js");
  try {
    await Bun.write(worker, "while (true) {}\n");
    await expect(renderInWorker(worker, {}, 50)).rejects.toThrow("render exceeded 50ms");
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 5_000);

test("leaves no partial output after a runtime failure", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const document = join(directory, "failure.mdx");
  const output = join(directory, "output");
  try {
    await Bun.write(document, "---\nmdxx:\n  format: 1\n---\n\n{(() => { throw new Error('render boom') })()}\n");
    await expect(build(document, { output })).rejects.toThrow("render boom");
    expect(await Bun.file(output).exists()).toBe(false);
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);

test("hashes, deduplicates, and rewrites local assets and CSS", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const document = join(directory, "assets.mdx");
  try {
    await Bun.write(join(directory, "one.png"), "same bytes");
    await Bun.write(join(directory, "two.png"), "same bytes");
    await Bun.write(join(directory, "style.css"), ".hero { background: url('./one.png'); color: rgb(1, 2, 3); }");
    await Bun.write(
      document,
      `---
mdxx:
  format: 1
---

import './style.css'

![One](./one.png)

<img src="./two.png" />

![Remote](https://example.test/image.png)
`,
    );
    const htmlPath = await build(document, { output: join(directory, "output") });
    const html = await Bun.file(htmlPath).text();
    const files = await Array.fromAsync(new Bun.Glob("assets/*").scan({ cwd: join(directory, "output") }));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^assets\/one\.[0-9a-f]{8}\.png$/);
    expect(html.match(/assets\/one\.[0-9a-f]{8}\.png/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("https://example.test/image.png");
    expect(html).toContain("color:#010203");
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);
