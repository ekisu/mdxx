import { expect, test } from "bun:test";
import { join } from "node:path";
import { startRun } from "../src/commands/run.ts";

test("serves a temporary build on loopback", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const document = join(directory, "run.mdx");
  await Bun.write(document, "---\nmdxx:\n  format: 1\n---\n\n# Served\n");
  try {
    const session = await startRun(document);
    try {
      expect(new URL(session.url).hostname).toBe("127.0.0.1");
      const response = await fetch(session.url);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("<h1>Served</h1>");
      expect((await fetch(new URL("../outside", session.url))).status).toBe(404);
    } finally {
      await session.close();
    }
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);
