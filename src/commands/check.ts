import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkBrowser, type CheckError } from "../check/browser.ts";
import { formatError, MdxxError } from "../shared/errors.ts";
import { build } from "./build.ts";
import { resolveBrowser } from "./smoke.ts";

export type CheckPhase = "build" | "mount" | "probe";
export type CheckFailurePhase = "setup" | CheckPhase;
type PhaseState = "passed" | "failed" | "skipped";

export interface CheckOptions {
  probe: string;
  locked?: boolean;
  browser?: string;
  timeout?: number;
  onBuildComplete?: () => void;
}

export interface CheckResult {
  ok: boolean;
  phase: CheckFailurePhase;
  phases: Record<CheckPhase, PhaseState>;
  browser: string;
  error?: CheckError;
  probe?: unknown;
  console: string[];
  diagnostics?: string[];
}

function errorDetails(error: unknown, seen = new Set<unknown>()): CheckError {
  if (!(error instanceof Error)) return { message: String(error) };
  if (seen.has(error)) return { name: error.name, message: error.message };
  seen.add(error);
  return {
    name: error.name,
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
    ...(error.cause === undefined ? {} : { cause: errorDetails(error.cause, seen) }),
  };
}

function failure(error: unknown): Pick<CheckResult, "error" | "diagnostics"> {
  const formatted = formatError(error).split("\n").slice(1).join("\n");
  return {
    error: errorDetails(error),
    ...(formatted ? { diagnostics: [formatted] } : {}),
  };
}

export async function check(path: string, options: CheckOptions): Promise<CheckResult> {
  const timeout = options.timeout ?? 10_000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300_000) {
    throw new MdxxError("USAGE", "--timeout must be an integer between 1 and 300000 milliseconds");
  }

  const browser = await resolveBrowser(options.browser);
  const phases: CheckResult["phases"] = { build: "skipped", mount: "skipped", probe: "skipped" };
  let temporary: string | undefined;
  try {
    let probe: string;
    try {
      probe = await readFile(resolve(options.probe), "utf8");
    } catch (error) {
      return { ok: false, phase: "setup", phases, browser, console: [], ...failure(error) };
    }

    try {
      temporary = await mkdtemp(join(tmpdir(), "mdxx-check-"));
    } catch (error) {
      return { ok: false, phase: "setup", phases, browser, console: [], ...failure(error) };
    }

    let htmlPath: string;
    try {
      htmlPath = await build(path, { output: join(temporary, "output"), locked: options.locked });
      phases.build = "passed";
      options.onBuildComplete?.();
    } catch (error) {
      phases.build = "failed";
      return { ok: false, phase: "build", phases, browser, console: [], ...failure(error) };
    }

    const controller = new AbortController();
    const interrupt = (): void => controller.abort();
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    let result;
    try {
      result = await checkBrowser(htmlPath, probe, { browser, timeout, signal: controller.signal });
    } finally {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", interrupt);
    }
    if (result.phase === "setup") {
      return {
        ok: false,
        phase: "setup",
        phases,
        browser,
        console: result.console,
        ...(result.error ? { error: result.error } : {}),
      };
    }
    if (result.phase === "mount") {
      phases.mount = result.ok ? "passed" : "failed";
    } else {
      phases.mount = "passed";
      phases.probe = result.ok ? "passed" : "failed";
    }
    return {
      ok: result.ok,
      phase: result.phase,
      phases,
      browser,
      console: result.console,
      ...(result.error ? { error: result.error } : {}),
      ...(result.probe === undefined ? {} : { probe: result.probe }),
    };
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}
