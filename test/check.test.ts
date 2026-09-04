import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acceptCallback,
  checkBrowser,
  drainBrowserDiagnostics,
  readBoundedBody,
  type CallbackProtocolState,
} from "../src/check/browser.ts";
import { main } from "../src/cli.ts";
import { build } from "../src/commands/build.ts";
import { check } from "../src/commands/check.ts";

const browser = process.env.CHROMIUM_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const document = join(import.meta.dir, "fixtures/check-document.mdx");
const successProbe = join(import.meta.dir, "fixtures/check-success.js");

test("builds once and completes immediately after a generic interaction probe", async () => {
  let completedBuilds = 0;
  const started = performance.now();
  const result = await check(document, {
    probe: successProbe,
    browser,
    timeout: 20_000,
    onBuildComplete: () => completedBuilds++,
  });
  const elapsed = performance.now() - started;

  expect(result).toMatchObject({
    ok: true,
    phase: "probe",
    phases: { build: "passed", mount: "passed", probe: "passed" },
    browser,
    probe: { heading: "Interactive counter", count: 1 },
  });
  expect(completedBuilds).toBe(1);
  expect(elapsed).toBeLessThan(10_000);
}, 30_000);

test("reports a thrown probe failure with browser diagnostics", async () => {
  const result = await check(document, {
    probe: join(import.meta.dir, "fixtures/check-throws.js"),
    browser,
    timeout: 5_000,
  });

  expect(result).toMatchObject({
    ok: false,
    phase: "probe",
    phases: { build: "passed", mount: "passed", probe: "failed" },
    browser,
    error: { message: "deliberate probe failure" },
  });
  expect(result.error?.stack).toContain("deliberate probe failure");
  expect(result.console.some((entry) => entry.includes("probe console diagnostic"))).toBe(true);
}, 30_000);

test("preserves mount error stack and cause", async () => {
  const result = await check(join(import.meta.dir, "fixtures/check-mount-error.mdx"), {
    probe: successProbe,
    browser,
    timeout: 5_000,
  });

  expect(result).toMatchObject({
    ok: false,
    phase: "mount",
    phases: { build: "passed", mount: "failed", probe: "skipped" },
    error: {
      message: "mount failed",
      cause: { message: "mount root cause" },
    },
  });
  expect(result.error?.stack).toContain("mount failed");
}, 30_000);

test("bounds probe waits by the check timeout", async () => {
  const result = await check(document, {
    probe: join(import.meta.dir, "fixtures/check-timeout.js"),
    browser,
    timeout: 100,
  });

  expect(result).toMatchObject({
    ok: false,
    phase: "probe",
    phases: { build: "passed", mount: "passed", probe: "failed" },
  });
  expect(result.error?.message).toContain("never became ready");
}, 30_000);

test("requires the callback token and enforces mount-result protocol order", () => {
  const token = "expected-token";
  const state: CallbackProtocolState = { mounted: false, settled: false };
  expect(acceptCallback({ type: "mounted" }, "wrong-token", token, state).status).toBe(403);
  expect(acceptCallback({ type: "result", result: { ok: true, phase: "probe", probe: null } }, token, token, state).status).toBe(409);
  expect(acceptCallback({ type: "result", result: { ok: true, phase: "mount", probe: null } }, token, token, state).status).toBe(409);
  expect(acceptCallback({ type: "mounted" }, token, token, state).status).toBe(204);
  expect(acceptCallback({ type: "result", result: { ok: false, phase: "mount", error: { message: "late mount" } } }, token, token, state).status).toBe(409);
  const accepted = acceptCallback({ type: "result", result: { ok: true, phase: "probe", probe: { value: 1 } } }, token, token, state);
  expect(accepted).toMatchObject({ status: 204, result: { ok: true, phase: "probe" } });
  expect(acceptCallback({ type: "mounted" }, token, token, state).status).toBe(409);

  const mountFailure: CallbackProtocolState = { mounted: false, settled: false };
  expect(acceptCallback({ type: "result", result: { ok: false, phase: "mount", error: { message: "failed" } } }, token, token, mountFailure))
    .toMatchObject({ status: 204, result: { ok: false, phase: "mount" } });
});

test("hides the bootstrap from document code and uses captured fetch for the callback", async () => {
  const result = await check(document, {
    probe: join(import.meta.dir, "fixtures/check-bootstrap-integrity.js"),
    browser,
    timeout: 5_000,
  });
  expect(result).toMatchObject({
    ok: true,
    phases: { build: "passed", mount: "passed", probe: "passed" },
    probe: { ordinaryArtifact: true, bootstrapRemoved: true },
  });
}, 30_000);

test("strictly rejects values that JSON would omit or transform", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "mdxx-check-json-test-"));
  try {
    const htmlPath = await build(document, { output: join(temporary, "output") });
    const cases = [
      ["return undefined;", "contains undefined"],
      ["return {value: undefined};", "$.value contains undefined"],
      ["return [undefined];", "$[0] contains undefined"],
      ["return [function () {}];", "$[0] contains function"],
      ["return {value: Symbol('x')};", "$.value contains symbol"],
      ["return {value: 1n};", "$.value contains bigint"],
      ["return {value: NaN};", "$.value contains a non-finite number"],
      ["return {value: Infinity};", "$.value contains a non-finite number"],
      ["return {value: -0};", "$.value contains negative zero"],
      ["const value = {}; value.self = value; return value;", "$.self contains a cycle"],
    ] as const;
    for (const [probe, message] of cases) {
      const result = await checkBrowser(htmlPath, probe, { browser, timeout: 3_000 });
      expect(result).toMatchObject({ ok: false, phase: "probe" });
      expect(result.error?.message).toContain(message);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}, 60_000);

test("bounds callback bodies while reading their stream", async () => {
  let emitted = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      emitted++;
      controller.enqueue(new Uint8Array(4));
      if (emitted === 100) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("http://127.0.0.1/callback", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  expect(await readBoundedBody(request, 8)).toBeUndefined();
  expect(cancelled).toBe(true);
  expect(emitted).toBeLessThan(100);
});

test("drains browser diagnostics with bounded retention", async () => {
  let emitted = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted++ === 100) {
        controller.close();
        return;
      }
      controller.enqueue(new TextEncoder().encode(`INFO:CONSOLE: ${"x".repeat(8_192)}\n`));
    },
  });
  const diagnostics = drainBrowserDiagnostics(stream);
  await diagnostics.done;
  expect(diagnostics.lines.join("").length).toBeLessThanOrEqual(64 * 1024);
  expect(diagnostics.lines.at(-1)).toBe("mdxx: browser diagnostics truncated");
});

test("emits compact usage and setup JSON even when option parsing fails early", async () => {
  const output: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (value) => output.push(String(value));
  console.error = (value) => errors.push(String(value));
  try {
    expect(await main(["check", "--probe", "--json"])).toBe(2);
    expect(await main(["check", "--json", "--probe", join(tmpdir(), "missing-check-probe.js"), document])).toBe(1);
    expect(await main(["smoke", "--probe", successProbe, document])).toBe(2);

    expect(output).toHaveLength(2);
    expect(output.every((entry) => !entry.includes("\n"))).toBe(true);
    expect(JSON.parse(output[0]!)).toMatchObject({
      ok: false,
      phase: "usage",
      phases: { build: "skipped", mount: "skipped", probe: "skipped" },
    });
    expect(JSON.parse(output[1]!)).toMatchObject({
      ok: false,
      phase: "setup",
      phases: { build: "skipped", mount: "skipped", probe: "skipped" },
    });
    expect(errors).toHaveLength(1);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});

test("prints probe stacks and collected console diagnostics in human mode", async () => {
  const errors: string[] = [];
  const original = console.error;
  console.error = (value) => errors.push(String(value));
  try {
    const code = await main(["check", document, "--probe", join(import.meta.dir, "fixtures/check-throws.js"), "--browser", browser]);
    expect(code).toBe(1);
    expect(errors.some((entry) => entry.includes("deliberate probe failure"))).toBe(true);
    expect(errors.some((entry) => entry.includes("probe console diagnostic"))).toBe(true);
  } finally {
    console.error = original;
  }
}, 30_000);

test("removes temporary browser profiles when browser setup fails", async () => {
  const profiles = async (): Promise<string[]> => (await readdir(tmpdir())).filter((name) => name.startsWith("mdxx-check-chrome-")).sort();
  const before = await profiles();
  const result = await check(document, {
    probe: successProbe,
    browser: join(tmpdir(), `missing-chrome-${crypto.randomUUID()}`),
    timeout: 1_000,
  });
  expect(result.phase).toBe("setup");
  expect(await profiles()).toEqual(before);
}, 30_000);
