import { expect, test } from "bun:test";
import { join } from "node:path";
import { resolveBrowser, smoke } from "../src/commands/smoke.ts";

test("resolves explicit browser choices before automatic discovery", async () => {
  const isExecutable = async (): Promise<boolean> => {
    throw new Error("automatic discovery should not run");
  };
  expect(await resolveBrowser("/explicit/chrome", { platform: "darwin", environment: { CHROMIUM_PATH: "/environment/chrome" }, isExecutable })).toBe(
    "/explicit/chrome",
  );
  expect(await resolveBrowser(undefined, { platform: "darwin", environment: { CHROMIUM_PATH: "/environment/chrome" }, isExecutable })).toBe(
    "/environment/chrome",
  );
});

test("discovers system and user macOS browser applications", async () => {
  const systemChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  expect(await resolveBrowser(undefined, { platform: "darwin", environment: {}, home: "/Users/test", isExecutable: async (path) => path === systemChrome })).toBe(
    systemChrome,
  );

  const userChrome = "/Users/test/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  expect(await resolveBrowser(undefined, { platform: "darwin", environment: {}, home: "/Users/test", isExecutable: async (path) => path === userChrome })).toBe(
    userChrome,
  );

  const systemChromium = "/Applications/Chromium.app/Contents/MacOS/Chromium";
  expect(await resolveBrowser(undefined, { platform: "darwin", environment: {}, home: "/Users/test", isExecutable: async (path) => path === systemChromium })).toBe(
    systemChromium,
  );

  const userChromium = "/Users/test/Applications/Chromium.app/Contents/MacOS/Chromium";
  expect(await resolveBrowser(undefined, { platform: "darwin", environment: {}, home: "/Users/test", isExecutable: async (path) => path === userChromium })).toBe(
    userChromium,
  );
});

test("skips unavailable macOS applications and keeps the chromium fallback", async () => {
  expect(await resolveBrowser(undefined, { platform: "darwin", environment: {}, home: "/Users/test", isExecutable: async () => false })).toBe("chromium");
  expect(await resolveBrowser(undefined, { platform: "linux", environment: {}, isExecutable: async () => true })).toBe("chromium");
});

test("reports the selected browser when no executable can be launched", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const document = join(directory, "missing-browser.mdx");
  const browser = join(directory, "missing-browser");
  try {
    await Bun.write(document, "---\nmdxx:\n  format: 1\n---\n\n# Missing browser\n");
    const result = await smoke(document, { browser });
    expect(result).toMatchObject({ ok: false, state: "error", phase: "setup", browser });
    expect(result.error?.message).toContain(browser);
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
});

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
    expect(result.browser).toBe(process.env.CHROMIUM_PATH ?? "chromium");
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
