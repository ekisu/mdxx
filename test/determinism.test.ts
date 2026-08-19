import { expect, test } from "bun:test";
import { join } from "node:path";
import { build } from "../src/commands/build.ts";

test("produces identical trees from separate source directories", async () => {
  const temporary = (await Bun.$`mktemp -d`.text()).trim();
  try {
    for (const name of ["first", "second"]) {
      const root = join(temporary, name);
      await Bun.write(join(root, "image.bin"), new Uint8Array([0, 1, 2, 3]));
      await Bun.write(
        join(root, "report.mdx"),
        "---\ntitle: Deterministic\nmdxx:\n  format: 1\n---\n\n# Report\n\n![asset](./image.bin)\n",
      );
      await build(join(root, "report.mdx"), { output: join(root, "dist") });
    }

    const readTree = async (root: string): Promise<Array<[string, Uint8Array]>> => {
      const paths = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: root, onlyFiles: true }));
      paths.sort();
      return Promise.all(paths.map(async (path) => [path, new Uint8Array(await Bun.file(join(root, path)).arrayBuffer())]));
    };
    const first = await readTree(join(temporary, "first", "dist"));
    const second = await readTree(join(temporary, "second", "dist"));
    expect(first.map(([path]) => path)).toEqual(second.map(([path]) => path));
    expect(first.map(([, bytes]) => bytes)).toEqual(second.map(([, bytes]) => bytes));
  } finally {
    await Bun.$`rm -rf ${temporary}`;
  }
}, 30_000);
