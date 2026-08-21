import { expect, test } from "bun:test";
import { join } from "node:path";
import { build } from "../src/commands/build.ts";
import { compileMdx } from "../src/render/compile.ts";

test("highlights recognized code fences and preserves plain fallbacks", async () => {
  const compiled = await compileMdx(
    "code.mdx",
    "---\nmdxx:\n  format: 1\n---\n\n```css\n:root { color: red; }\n```\n\n```not-a-language\nplain <code>\n```\n\n```\nno language\n```\n",
  );

  expect(compiled).toContain('className: "shiki shiki-themes github-light github-dark"');
  expect(compiled).toContain('className: "language-css"');
  expect(compiled).toContain("--shiki-dark");
  expect(compiled).toContain('className: "language-not-a-language"');
  expect(compiled).toContain('children: "plain <code>\\n"');
  expect(compiled).toContain("no language");
});

test("builds a deterministic client-only HTML shell", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const document = join(directory, "hello.mdx");
  try {
    await Bun.write(document, "---\ntitle: Render test\nmdxx:\n  format: 1\n---\n\n# Heading\n");
    const firstPath = await build(document, { output: join(directory, "first") });
    const secondPath = await build(document, { output: join(directory, "second") });
    const first = await Bun.file(firstPath).text();
    const second = await Bun.file(secondPath).text();
    expect(first).toBe(second);
    expect(first).toContain('<main id="mdxx-root"></main>');
    expect(first).toContain("requires JavaScript");
    expect(first).toContain('<script id="mdxx-data" type="application/json">');
    expect(first).toContain("@media (prefers-color-scheme: dark)");
    expect(first).toMatch(/<script type="module" src="assets\/client-[a-z0-9]+\.js"><\/script>/);
    expect(first).not.toContain("<h1>Heading</h1>");
    expect(first).not.toContain(directory);
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);

test("does not execute document code while building", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const document = join(directory, "browser-only.mdx");
  try {
    await Bun.write(document, "---\nmdxx:\n  format: 1\n---\n\n{(() => { throw new Error('browser runtime only') })()}\n");
    const outputPath = await build(document, { output: join(directory, "output") });
    expect(await Bun.file(outputPath).exists()).toBe(true);
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);

test("transforms Mermaid fences and includes the browser renderer", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const document = join(directory, "diagram.mdx");
  try {
    await Bun.write(document, "---\nmdxx:\n  format: 1\n---\n\n```mermaid\nflowchart LR\n  Source --> HTML\n```\n");
    await build(document, { output: join(directory, "output") });
    const entry = (await Array.fromAsync(new Bun.Glob("assets/client-*.js").scan({ cwd: join(directory, "output") })))[0];
    expect(entry).toBeDefined();
    const files = await Array.fromAsync(new Bun.Glob("assets/*.js").scan({ cwd: join(directory, "output"), onlyFiles: true }));
    const javascript = await Promise.all(files.map((path) => Bun.file(join(directory, "output", path)).text()));
    expect(javascript.join("\n")).toContain("mdxx-mermaid");
    expect(javascript.join("\n")).not.toContain("language-mermaid");
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);

test("mounts relative typed TSX and emits local assets and CSS", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const document = join(directory, "assets.mdx");
  try {
    await Bun.write(join(directory, "Component.tsx"), "export const Component = () => <mark>relative</mark>\n");
    await Bun.write(join(directory, "one.png"), "asset bytes");
    await Bun.write(join(directory, "style.css"), ".hero { background: url('./one.png'); color: rgb(1, 2, 3); }");
    await Bun.write(
      document,
      "---\nmdxx:\n  format: 1\n---\n\nimport './style.css'\nimport {Component} from './Component.tsx'\n\n<Component />\n\n![One](./one.png)\n",
    );
    const htmlPath = await build(document, { output: join(directory, "output") });
    const html = await Bun.file(htmlPath).text();
    const files = await Array.fromAsync(new Bun.Glob("assets/*").scan({ cwd: join(directory, "output"), onlyFiles: true }));
    expect(files.some((path) => /^assets\/one\.[0-9a-f]{16}\.png$/.test(path))).toBe(true);
    const cssPath = files.find((path) => path.endsWith(".css"));
    expect(cssPath).toBeDefined();
    expect(await Bun.file(join(directory, "output", cssPath!)).text()).toContain("color:#010203");
    expect(html).toContain(`<link rel="stylesheet" href="${cssPath}">`);
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);
