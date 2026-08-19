import { MdxxError } from "../shared/errors.ts";

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

function terminate(child: Bun.Subprocess): void {
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // The subprocess may not be a process-group leader on this platform.
    }
  }
  child.kill("SIGKILL");
}

async function readLimited(stream: ReadableStream<Uint8Array>, child: Bun.Subprocess): Promise<{ text: string; limited: boolean }> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > MAX_OUTPUT_BYTES) {
      terminate(child);
      return { text: "", limited: true };
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes), limited: false };
}

export async function renderInWorker(
  serverPath: string,
  metadata: Record<string, unknown>,
  timeoutMilliseconds = 10_000,
): Promise<string> {
  const token = `@mdxx-result-${crypto.randomUUID()}@`;
  const grouped = process.platform !== "win32" ? Bun.which("setsid") : null;
  const limiter = process.platform === "linux" ? Bun.which("prlimit") : null;
  const renderCommand = limiter
    ? [limiter, "--cpu=15", "--", process.execPath, serverPath]
    : [process.execPath, serverPath];
  const child = Bun.spawn(grouped ? [grouped, ...renderCommand] : renderCommand, {
    cwd: process.platform === "win32" ? undefined : "/",
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
    terminate(child);
  }, timeoutMilliseconds);
  const [exitCode, stdoutResult, stderrResult] = await Promise.all([
    child.exited,
    readLimited(child.stdout, child),
    readLimited(child.stderr, child),
  ]).finally(() => clearTimeout(timer));

  const stdout = stdoutResult.text;
  const stderr = stderrResult.text;

  if (timedOut) throw new MdxxError("RENDER_TIMEOUT", `render exceeded ${timeoutMilliseconds}ms`);
  if (stdoutResult.limited || stderrResult.limited) {
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
