import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { MdxxError } from "../shared/errors.ts";
import { startRun } from "./run.ts";

export interface SmokeOptions {
  locked?: boolean;
  browser?: string;
  timeout?: number;
}

export interface SmokeResult {
  ok: boolean;
  state: string;
  phase: string;
  browser: string;
  error?: { name?: string; message: string; stack?: string; cause?: unknown };
  console: string[];
  failedRequests: string[];
}

interface BrowserResolutionContext {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  home?: string;
  isExecutable?: (path: string) => Promise<boolean>;
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false;
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveBrowser(browser?: string, context: BrowserResolutionContext = {}): Promise<string> {
  if (browser !== undefined) return browser;
  const environment = context.environment ?? process.env;
  if (environment.CHROMIUM_PATH !== undefined) return environment.CHROMIUM_PATH;
  if ((context.platform ?? process.platform) === "darwin") {
    const home = context.home ?? homedir();
    const candidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      join(home, "Applications/Chromium.app/Contents/MacOS/Chromium"),
    ];
    const executable = context.isExecutable ?? isExecutableFile;
    for (const candidate of candidates) {
      if (await executable(candidate)) return candidate;
    }
  }
  return "chromium";
}

function decodeResult(html: string): Omit<SmokeResult, "browser" | "console" | "failedRequests"> | undefined {
  const encoded = html.match(/\bdata-mdxx-result="([A-Za-z0-9+/=]+)"/)?.[1];
  if (!encoded) return undefined;
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as Omit<SmokeResult, "browser" | "console" | "failedRequests">;
}

export async function smoke(path: string, options: SmokeOptions = {}): Promise<SmokeResult> {
  const timeout = options.timeout ?? 10_000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300_000) {
    throw new MdxxError("USAGE", "--timeout must be an integer between 1 and 300000 milliseconds");
  }
  const controller = new AbortController();
  const interrupt = (): void => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  let session;
  let browser: Bun.Subprocess | undefined;
  let limit: ReturnType<typeof setTimeout> | undefined;
  try {
    session = await startRun(path, options.locked, controller.signal);
    const browserPath = await resolveBrowser(options.browser);
    let child: Bun.Subprocess<"ignore", "pipe", "pipe">;
    try {
      child = Bun.spawn(
        [
          browserPath,
          "--headless",
          "--no-sandbox",
          "--disable-gpu",
          "--enable-logging=stderr",
          `--virtual-time-budget=${timeout + 500}`,
          "--dump-dom",
          session.url,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
    } catch (error) {
      return {
        ok: false,
        state: "error",
        phase: "setup",
        browser: browserPath,
        error: { message: error instanceof Error ? error.message : String(error) },
        console: [],
        failedRequests: [],
      };
    }
    browser = child;
    limit = setTimeout(() => browser?.kill(), timeout + 5_000);
    const [exitCode, html, stderr] = await Promise.all([child.exited, child.stdout.text(), child.stderr.text()]);
    clearTimeout(limit);
    if (controller.signal.aborted) throw new MdxxError("INTERRUPTED", "browser smoke interrupted");
    const console = stderr.split("\n").filter((line) => /CONSOLE|mdxx: browser startup failed/i.test(line));
    const failedRequests = stderr.split("\n").filter((line) => /net::ERR_|Failed to load resource/i.test(line));
    const runtime = decodeResult(html);
    if (runtime && failedRequests.length === 0 && exitCode === 0) return { ...runtime, browser: browserPath, console, failedRequests };
    if (runtime) {
      return {
        ...runtime,
        ok: false,
        phase: runtime.ok && failedRequests.length > 0 ? "request" : runtime.phase,
        error: runtime.error ?? { message: failedRequests[0] ?? `browser exited with code ${exitCode}` },
        browser: browserPath,
        console,
        failedRequests,
      };
    }
    const state = html.match(/\bdata-mdxx-state="([^"]+)"/)?.[1] ?? "unknown";
    return {
      ok: false,
      state,
      phase: state === "loading" ? "loading" : "browser",
      error: { message: exitCode === 0 ? `timed out before mdxx reached a stable state after ${timeout}ms` : `browser exited with code ${exitCode}` },
      browser: browserPath,
      console,
      failedRequests,
    };
  } catch (error) {
    if (controller.signal.aborted) throw new MdxxError("INTERRUPTED", "browser smoke interrupted");
    throw error;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    clearTimeout(limit);
    browser?.kill();
    await session?.close();
  }
}
