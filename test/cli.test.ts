import { expect, test } from "bun:test";
import { join } from "node:path";
import { init } from "../src/commands/init.ts";
import { inspect } from "../src/commands/inspect.ts";
import { unlock } from "../src/commands/unlock.ts";
import { verify } from "../src/commands/verify.ts";
import { appendEmbeddedLock } from "../src/document/embedded-lock.ts";
import { parseDocument } from "../src/document/parse.ts";

test("init, inspect, verify, and unlock", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const path = join(directory, "example.mdx");
  try {
    await init(path);
    expect(() => init(path)).toThrow();
    const report = await inspect(path);
    expect(report.lock).toEqual({ present: false });
    await verify(path);

    const source = await Bun.file(path).text();
    const digest = parseDocument(source).sourceDigest;
    await Bun.write(path, appendEmbeddedLock(source, { sourceDigest: digest, packages: [] }));
    await unlock(path);
    expect(await Bun.file(path).text()).toBe(source);
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
});
