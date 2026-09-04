import { formatError } from "./shared/errors.ts";
import { init } from "./commands/init.ts";
import { inspect } from "./commands/inspect.ts";
import { unlock } from "./commands/unlock.ts";
import { verify } from "./commands/verify.ts";
import { build } from "./commands/build.ts";
import { lock } from "./commands/lock.ts";
import { run } from "./commands/run.ts";
import { smoke } from "./commands/smoke.ts";
import { check } from "./commands/check.ts";
import type { CheckError } from "./check/browser.ts";
import { canonicalJson } from "./shared/canonical-json.ts";
import { MdxxError } from "./shared/errors.ts";

const USAGE = `Usage: mdxx <init|run|build|lock|unlock|verify|inspect|smoke|check> [options] <document.mdx>

Build options:
  --output <path>  Output directory (default: dist)
  --locked         Require a current embedded lock
  --replace        Build a complete output tree, then safely replace the destination

Smoke options:
  --browser <path> Browser executable
  --timeout <ms>   Timeout in milliseconds (default: 10000)
  --json           Emit a structured result

Check options:
  --probe <path>   Trusted local JavaScript function body to run after mount (required)
  --locked         Require a current embedded lock
  --browser <path> Browser executable
  --timeout <ms>   Timeout in milliseconds (default: 10000)
  --json           Emit a compact structured result

Browser selection: --browser, CHROMIUM_PATH, standard macOS Chrome or Chromium apps, then chromium on PATH.

Replacement is opt-in. A failed build leaves the existing output unchanged.`;

function documentArgument(args: string[]): string {
  const unknown = args.find((argument) => argument.startsWith("-"));
  if (unknown) throw new MdxxError("USAGE", `unknown option: ${unknown}`);
  const paths = args.filter((argument) => !argument.startsWith("-"));
  if (paths.length !== 1) throw new MdxxError("USAGE", USAGE);
  return paths[0] as string;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new MdxxError("USAGE", `${name} requires a value`);
  args.splice(index, 2);
  return value;
}

function printCheckError(error: CheckError | undefined): void {
  if (!error) return;
  if (error.stack) console.error(error.stack);
  let cause = error.cause;
  while (cause) {
    console.error(`Caused by: ${cause.message}`);
    if (cause.stack) console.error(cause.stack);
    cause = cause.cause;
  }
}

export async function main(args: string[]): Promise<number> {
  const jsonOutput = args.includes("--json");
  try {
    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
      console.log(USAGE);
      return 0;
    }

    const [command, ...argumentsForCommand] = args;
    const rest = [...argumentsForCommand];
    const output = option(rest, "--output");
    const probe = option(rest, "--probe");
    const browser = option(rest, "--browser");
    const timeoutValue = option(rest, "--timeout");
    const jsonIndex = rest.indexOf("--json");
    const json = jsonIndex >= 0;
    if (json) rest.splice(jsonIndex, 1);
    const lockedIndex = rest.indexOf("--locked");
    const locked = lockedIndex >= 0;
    if (locked) rest.splice(lockedIndex, 1);
    const replaceIndex = rest.indexOf("--replace");
    const replace = replaceIndex >= 0;
    if (replace) rest.splice(replaceIndex, 1);
    if (output !== undefined && command !== "build") throw new MdxxError("USAGE", "--output is only valid for build");
    if (probe !== undefined && command !== "check") throw new MdxxError("USAGE", "--probe is only valid for check");
    if (command === "check" && probe === undefined) throw new MdxxError("USAGE", "--probe is required for check");
    if (locked && command !== "build" && command !== "run" && command !== "smoke" && command !== "check") throw new MdxxError("USAGE", "--locked is only valid for build, run, smoke, and check");
    if (replace && command !== "build") throw new MdxxError("USAGE", "--replace is only valid for build");
    if ((browser !== undefined || timeoutValue !== undefined || json) && command !== "smoke" && command !== "check") throw new MdxxError("USAGE", "--browser, --timeout, and --json are only valid for smoke and check");
    const path = documentArgument(rest);
    switch (command) {
      case "init":
        await init(path);
        console.log(`Created ${path}`);
        break;
      case "unlock":
        await unlock(path);
        console.log(`Unlocked ${path}`);
        break;
      case "lock":
        await lock(path);
        console.log(`Locked ${path}`);
        break;
      case "inspect":
        console.log(canonicalJson(await inspect(path), 2));
        break;
      case "verify":
        await verify(path);
        console.log(`${path}: valid`);
        break;
      case "build": {
        const html = await build(path, { output: output ?? "dist", locked, replace });
        console.log(`Built ${html}`);
        break;
      }
      case "run":
        await run(path, locked);
        break;
      case "smoke": {
        const report = await smoke(path, { locked, browser, ...(timeoutValue === undefined ? {} : { timeout: Number(timeoutValue) }) });
        if (json) console.log(canonicalJson(report, 2));
        else if (report.ok) console.log(`${path}: browser smoke passed`);
        else {
          console.error(`mdxx: browser smoke failed during ${report.phase}: ${report.error?.message ?? "unknown error"}`);
          if (report.error?.stack) console.error(report.error.stack);
          for (const request of report.failedRequests) console.error(request);
          for (const entry of report.console) console.error(entry);
        }
        return report.ok ? 0 : 1;
      }
      case "check": {
        const report = await check(path, { probe: probe!, locked, browser, ...(timeoutValue === undefined ? {} : { timeout: Number(timeoutValue) }) });
        if (json) console.log(canonicalJson(report));
        else if (report.ok) console.log(`${path}: check passed`);
        else {
          console.error(`mdxx: check failed during ${report.phase}: ${report.error?.message ?? "unknown error"}`);
          printCheckError(report.error);
          for (const diagnostic of report.diagnostics ?? []) console.error(diagnostic);
          for (const entry of report.console) console.error(entry);
        }
        return report.ok ? 0 : 1;
      }
      default:
        throw new MdxxError("USAGE", `unknown command: ${command}\n${USAGE}`);
    }
    return 0;
  } catch (error) {
    if (jsonOutput) {
      const message = error instanceof Error ? error.message : String(error);
      if (args[0] === "check") {
        const phase = error instanceof MdxxError && error.code === "USAGE" ? "usage" : "setup";
        console.log(canonicalJson({ ok: false, phase, phases: { build: "skipped", mount: "skipped", probe: "skipped" }, error: { message }, console: [] }));
      } else {
        console.log(canonicalJson({ ok: false, state: "error", phase: "setup", error: { message }, console: [], failedRequests: [] }, 2));
      }
    } else console.error(formatError(error));
    return error instanceof MdxxError && error.code === "USAGE" ? 2 : 1;
  }
}
