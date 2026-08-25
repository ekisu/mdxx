import { expect, test } from "bun:test";
import { join } from "node:path";
import { build } from "../src/commands/build.ts";
import { lock } from "../src/commands/lock.ts";
import { main } from "../src/cli.ts";

const source = (body: string): string => `---
mdxx:
  format: 1
---

${body}
`;

async function readTree(root: string): Promise<Array<[string, Uint8Array]>> {
  const paths = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: root, onlyFiles: true }));
  paths.sort();
  return Promise.all(paths.map(async (path) => [path, new Uint8Array(await Bun.file(join(root, path)).arrayBuffer())]));
}

test("refuses to replace existing output by default", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const document = join(directory, "document.mdx");
  const output = join(directory, "dist");
  try {
    await Bun.write(document, source("# First"));
    await build(document, { output });
    await expect(build(document, { output })).rejects.toThrow("output path already exists");

    const original = console.log;
    console.log = () => {};
    try {
      expect(await main(["build", document, "--output", output, "--replace"])).toBe(0);
    } finally {
      console.log = original;
    }
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);

test("failed replacement leaves the previous output byte-for-byte intact", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const document = join(directory, "document.mdx");
  const output = join(directory, "dist");
  try {
    await Bun.write(document, source("# Stable"));
    await build(document, { output });
    const before = await readTree(output);

    await Bun.write(document, source("import './missing.ts'\n\n# Broken"));
    await expect(build(document, { output, replace: true })).rejects.toThrow("cannot resolve ./missing.ts");
    expect(await readTree(output)).toEqual(before);
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);

test("locked replacement publishes complete HTML and content-addressed assets", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const document = join(directory, "document.mdx");
  const asset = join(directory, "image.bin");
  const output = join(directory, "dist");
  try {
    await Bun.write(asset, "old asset");
    await Bun.write(document, source("# Old\n\n![image](./image.bin)"));
    await build(document, { output });
    const oldFiles = (await readTree(output)).map(([path]) => path);

    await Bun.write(asset, "new asset");
    await Bun.write(document, source("# New\n\n![image](./image.bin)"));
    await lock(document);
    const htmlPath = await build(document, { output, locked: true, replace: true });
    const files = (await readTree(output)).map(([path]) => path);
    const html = await Bun.file(htmlPath).text();
    const assetPath = files.find((path) => /^assets\/image\.[0-9a-f]{16}\.bin$/.test(path));
    const htmlAssets = [...html.matchAll(/(?:src|href)="(assets\/[^"]+)"/g)].map((match) => match[1]!);

    expect(assetPath).toBeDefined();
    expect(await Bun.file(join(output, assetPath!)).text()).toBe("new asset");
    expect(htmlAssets.length).toBeGreaterThan(0);
    expect(await Promise.all(htmlAssets.map((path) => Bun.file(join(output, path)).exists()))).toEqual(htmlAssets.map(() => true));
    expect((await Promise.all(files.filter((path) => path.endsWith(".js")).map((path) => Bun.file(join(output, path)).text()))).join("\n"))
      .toContain(assetPath!);
    expect(files.some((path) => oldFiles.includes(path) && path.includes("image."))).toBe(false);
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);
