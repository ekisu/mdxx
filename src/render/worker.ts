import { MdxxError } from "../shared/errors.ts";

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export async function renderInWorker(
  serverPath: string,
  metadata: Record<string, unknown>,
  timeoutMilliseconds = 10_000,
): Promise<string> {
  const token = `@mdxx-result-${crypto.randomUUID()}@`;
  const child = Bun.spawn([process.execPath, serverPath], {
    env: { LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  child.stdin.write(JSON.stringify({ token, metadata }));
  child.stdin.end();

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMilliseconds);
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    child.stdout.text(),
    child.stderr.text(),
  ]).finally(() => clearTimeout(timer));

  if (timedOut) throw new MdxxError("RENDER_TIMEOUT", `render exceeded ${timeoutMilliseconds}ms`);
  if (stdout.length > MAX_OUTPUT_BYTES || stderr.length > MAX_OUTPUT_BYTES) {
    throw new MdxxError("RENDER_OUTPUT_LIMIT", "render subprocess produced too much output");
  }
  const marker = stdout.lastIndexOf(token);
  if (marker < 0) {
    throw new MdxxError("RENDER_FAILED", stderr.trim() || `render subprocess exited with code ${exitCode}`);
  }

  let response: unknown;
  try {
    response = JSON.parse(stdout.slice(marker + token.length).trim());
  } catch (cause) {
    throw new MdxxError("RENDER_FAILED", "render subprocess returned invalid output", { cause });
  }
  if (response === null || typeof response !== "object") {
    throw new MdxxError("RENDER_FAILED", "render subprocess returned an invalid response");
  }
  const result = response as { ok?: unknown; markup?: unknown; error?: unknown };
  if (result.ok !== true || typeof result.markup !== "string") {
    throw new MdxxError("RENDER_FAILED", typeof result.error === "string" ? result.error : "document render failed");
  }
  return result.markup;
}
