import { expect, test } from "bun:test";
import { join } from "node:path";
import { smoke } from "../src/commands/smoke.ts";

test("reports a mounted document", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const document = join(directory, "hook.mdx");
  try {
    await Bun.write(
      document,
      "---\nmdxx:\n  format: 1\n---\n\n# Mounted\n",
    );
    const result = await smoke(document, { browser: process.env.CHROMIUM_PATH ?? "chromium", timeout: 2_000 });
    expect(result).toMatchObject({ ok: true, state: "mounted", phase: "mounted" });
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);

test("reports document evaluation errors with nested causes", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const document = join(directory, "evaluation-error.mdx");
  try {
    await Bun.write(
      document,
      `---
mdxx:
  format: 1
---

export const value = await Promise.reject(new Error('evaluation failed', {cause: new Error('root cause')}))

# Never mounted
`,
    );
    const result = await smoke(document, { browser: process.env.CHROMIUM_PATH ?? "chromium", timeout: 2_000 });
    expect(result).toMatchObject({
      ok: false,
      state: "error",
      phase: "loading",
      error: { message: "evaluation failed", cause: { message: "root cause" } },
    });
    expect(result.error?.stack).toContain("evaluation failed");
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);

test("reports React startup errors during mounting", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const document = join(directory, "render-error.mdx");
  try {
    await Bun.write(document, "---\nmdxx:\n  format: 1\n---\n\n{(() => { throw new Error('render failed') })()}\n");
    const result = await smoke(document, { browser: process.env.CHROMIUM_PATH ?? "chromium", timeout: 2_000 });
    expect(result).toMatchObject({ ok: false, state: "error", phase: "mounting", error: { message: "render failed" } });
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);

test("times out before a document reaches a stable state", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const document = join(directory, "timeout.mdx");
  try {
    await Bun.write(
      document,
      "---\nmdxx:\n  format: 1\n---\n\nexport const pending = await new Promise(() => {})\n\n# Timeout\n",
    );
    const result = await smoke(document, { browser: process.env.CHROMIUM_PATH ?? "chromium", timeout: 100 });
    expect(result).toMatchObject({ ok: false, state: "loading", phase: "loading" });
    expect(result.error?.message).toBe("timed out before mdxx reached a stable state after 100ms");
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);
