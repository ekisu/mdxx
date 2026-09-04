import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MdxxError } from "../shared/errors.ts";
import { serveOutput, type RunSession } from "../commands/run.ts";

export interface CheckError {
  name?: string;
  message: string;
  stack?: string;
  cause?: CheckError;
}

export interface BrowserCheckResult {
  ok: boolean;
  phase: "setup" | "mount" | "probe";
  error?: CheckError;
  probe?: unknown;
  console: string[];
}

interface PostedResult {
  ok: boolean;
  phase: "mount" | "probe";
  error?: CheckError;
  probe?: unknown;
}

export interface CallbackProtocolState {
  mounted: boolean;
  settled: boolean;
}

interface CallbackAcceptance {
  status: number;
  result?: PostedResult;
}

const MAX_CALLBACK_BYTES = 1_000_000;
const MAX_DIAGNOSTIC_CHARS = 64 * 1024;
const MAX_DIAGNOSTIC_LINE_CHARS = 8 * 1024;

function checkError(value: unknown): value is CheckError {
  if (!value || typeof value !== "object") return false;
  const error = value as Partial<CheckError>;
  return typeof error.message === "string" && (error.cause === undefined || checkError(error.cause));
}

export function acceptCallback(
  message: unknown,
  presentedToken: string | null,
  expectedToken: string,
  state: CallbackProtocolState,
): CallbackAcceptance {
  if (presentedToken !== expectedToken) return { status: 403 };
  if (!message || typeof message !== "object" || state.settled) return { status: 409 };
  const envelope = message as { type?: unknown; result?: unknown };
  if (envelope.type === "mounted") {
    if (state.mounted) return { status: 409 };
    state.mounted = true;
    return { status: 204 };
  }
  if (envelope.type !== "result" || !envelope.result || typeof envelope.result !== "object") return { status: 400 };
  const result = envelope.result as Partial<PostedResult>;
  if (result.ok === true) {
    if (result.phase !== "probe" || !state.mounted || !Object.hasOwn(result, "probe")) return { status: 409 };
  } else if (result.ok === false) {
    if (!checkError(result.error)) return { status: 400 };
    if (result.phase === "mount") {
      if (state.mounted) return { status: 409 };
    } else if (result.phase === "probe") {
      if (!state.mounted) return { status: 409 };
    } else return { status: 400 };
  } else return { status: 400 };
  state.settled = true;
  return { status: 204, result: result as PostedResult };
}

export async function readBoundedBody(request: Request, limit = MAX_CALLBACK_BYTES): Promise<string | undefined> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await Promise.race([reader.cancel().catch(() => {}), Bun.sleep(250)]);
        return undefined;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

export function drainBrowserDiagnostics(stream: ReadableStream<Uint8Array>): {
  lines: string[];
  done: Promise<void>;
  cancel(): Promise<void>;
} {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const lines: string[] = [];
  const truncationMarker = "mdxx: browser diagnostics truncated";
  const contentLimit = MAX_DIAGNOSTIC_CHARS - truncationMarker.length;
  let pending = "";
  let retained = 0;
  let truncated = false;
  const append = (line: string): void => {
    if (!/CONSOLE|mdxx: browser/i.test(line)) return;
    if (retained >= contentLimit) {
      truncated = true;
      return;
    }
    const kept = line.slice(0, contentLimit - retained);
    lines.push(kept);
    retained += kept.length;
    if (kept.length < line.length) truncated = true;
  };
  const consume = (flush = false): void => {
    while (true) {
      const newline = pending.indexOf("\n");
      if (newline >= 0) {
        append(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      } else if (pending.length > MAX_DIAGNOSTIC_LINE_CHARS) {
        append(pending.slice(0, MAX_DIAGNOSTIC_LINE_CHARS));
        pending = pending.slice(MAX_DIAGNOSTIC_LINE_CHARS);
      } else break;
    }
    if (flush && pending) append(pending);
  };
  const done = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        consume();
      }
      pending += decoder.decode();
      consume(true);
    } catch {}
    if (truncated) lines.push(truncationMarker);
  })();
  return {
    lines,
    done,
    async cancel() {
      await Promise.race([reader.cancel().catch(() => {}), Bun.sleep(250)]);
    },
  };
}

function injectedScript(probe: string, timeout: number, callbackPath: string, callbackToken: string): string {
  const encodedProbe = Buffer.from(probe, "utf8").toString("base64");
  return `<script>
(() => {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  document.currentScript?.remove();
  const shell = document.documentElement;
  const deadline = Date.now() + ${timeout};
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const details = (error, seen = new Set()) => {
    if (error instanceof Error) {
      if (seen.has(error)) return {name: error.name, message: error.message};
      seen.add(error);
      return {
        name: error.name,
        message: error.message,
        ...(error.stack ? {stack: error.stack} : {}),
        ...(error.cause === undefined ? {} : {cause: details(error.cause, seen)}),
      };
    }
    return {message: String(error)};
  };
  const post = async value => {
    const response = await nativeFetch('${callbackPath}', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Mdxx-Check-Token': '${callbackToken}'},
      body: JSON.stringify(value),
    });
    if (!response.ok) throw new Error('check callback failed with status ' + response.status);
  };
  const runtimeError = () => {
    try {
      const encoded = shell.dataset.mdxxResult;
      if (!encoded) return {message: shell.dataset.mdxxError || 'document failed to mount'};
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes)).error || {message: shell.dataset.mdxxError || 'document failed to mount'};
    } catch {
      return {message: shell.dataset.mdxxError || 'document failed to mount'};
    }
  };
  const awaitMount = () => new Promise(resolve => {
    let timer;
    const observer = new MutationObserver(() => settle());
    const settle = () => {
      if (shell.dataset.mdxxState === 'mounted') {
        clearTimeout(timer);
        observer.disconnect();
        resolve({ok: true});
      } else if (shell.dataset.mdxxState === 'error') {
        clearTimeout(timer);
        observer.disconnect();
        resolve({ok: false, error: runtimeError()});
      }
    };
    observer.observe(shell, {attributes: true, attributeFilter: ['data-mdxx-state']});
    timer = setTimeout(() => {
      observer.disconnect();
      resolve({ok: false, error: {message: 'document did not mount before the check timeout'}});
    }, Math.max(0, deadline - Date.now()));
    settle();
  });
  const waitFor = async (test, message = 'condition was not met') => {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const value = await Promise.race([
        Promise.resolve().then(test),
        sleep(remaining).then(() => { throw new Error(message + ' before the check timeout'); }),
      ]);
      if (value) return value;
      await sleep(Math.min(25, Math.max(0, deadline - Date.now())));
    }
    throw new Error(message + ' before the check timeout');
  };
  const shadowRoots = (start = document) => {
    const found = [start];
    for (let index = 0; index < found.length; index++) {
      for (const element of found[index].querySelectorAll('*')) {
        if (element.shadowRoot && !found.includes(element.shadowRoot)) found.push(element.shadowRoot);
      }
    }
    return found;
  };
  const queryAll = (selector, start) => shadowRoots(start || document.getElementById('mdxx-root') || document)
    .flatMap(current => [...current.querySelectorAll(selector)]);
  const query = (selector, start) => queryAll(selector, start)[0] || null;
  const assertJsonSafe = (value, path = '$', ancestors = new Set()) => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(path + ' contains a non-finite number');
      if (Object.is(value, -0)) throw new Error(path + ' contains negative zero');
      return;
    }
    if (typeof value !== 'object') throw new Error(path + ' contains ' + typeof value);
    if (ancestors.has(value)) throw new Error(path + ' contains a cycle');
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index++) {
          if (!Object.hasOwn(value, index)) throw new Error(path + '[' + index + '] is missing');
          assertJsonSafe(value[index], path + '[' + index + ']', ancestors);
        }
        const extras = Reflect.ownKeys(value).filter(key => {
          if (key === 'length') return false;
          if (typeof key !== 'string') return true;
          const index = Number(key);
          return !Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key;
        });
        if (extras.length > 0) throw new Error(path + ' contains a non-JSON array property');
        return;
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) throw new Error(path + ' contains a non-plain object');
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string') throw new Error(path + ' contains a symbol key');
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable) throw new Error(path + '.' + key + ' is not enumerable');
        assertJsonSafe(value[key], path + '.' + key, ancestors);
      }
    } finally {
      ancestors.delete(value);
    }
  };

  (async () => {
    const mount = await awaitMount();
    if (!mount.ok) {
      await post({type: 'result', result: {ok: false, phase: 'mount', error: mount.error}});
      return;
    }
    await post({type: 'mounted'});

    const root = document.getElementById('mdxx-root');
    if (!root) throw new Error('mounted document has no root element');
    try {
      const source = new TextDecoder().decode(Uint8Array.from(atob('${encodedProbe}'), character => character.charCodeAt(0)));
      const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
      const result = await new AsyncFunction('root', 'waitFor', 'shadowRoots', 'query', 'queryAll', source)(
        root,
        waitFor,
        shadowRoots,
        query,
        queryAll,
      );
      assertJsonSafe(result);
      await post({type: 'result', result: {ok: true, phase: 'probe', probe: result}});
    } catch (error) {
      await post({type: 'result', result: {ok: false, phase: 'probe', error: details(error)}});
    }
  })().catch(error => void post({type: 'result', result: {ok: false, phase: 'probe', error: details(error)}}));
})();
</script>`;
}

async function terminate(browser: Bun.Subprocess): Promise<void> {
  if (browser.exitCode !== null) return;
  browser.kill("SIGTERM");
  const stopped = await Promise.race([
    browser.exited.then(() => true),
    Bun.sleep(500).then(() => false),
  ]);
  if (stopped || browser.exitCode !== null) return;
  browser.kill("SIGKILL");
  await Promise.race([browser.exited, Bun.sleep(1_000)]);
}

export async function checkBrowser(
  htmlPath: string,
  probe: string,
  options: { browser: string; timeout: number; signal?: AbortSignal },
): Promise<BrowserCheckResult> {
  const original = await Bun.file(htmlPath).text();
  const marker = "</body>";
  if (!original.includes(marker)) {
    return { ok: false, phase: "setup", error: { message: "built HTML has no body" }, console: [] };
  }

  const callbackPath = `/.mdxx-check-${crypto.randomUUID()}`;
  const callbackToken = crypto.randomUUID();
  const profile = await mkdtemp(join(tmpdir(), "mdxx-check-chrome-"));
  let session: RunSession | undefined;
  let browser: Bun.Subprocess<"ignore", "ignore", "pipe"> | undefined;
  let diagnostics: ReturnType<typeof drainBrowserDiagnostics> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const protocol: CallbackProtocolState = { mounted: false, settled: false };
  let resolveResult: (result: PostedResult) => void = () => {};
  const received = new Promise<PostedResult>((resolve) => {
    resolveResult = resolve;
  });
  try {
    const html = original.replace(marker, () => `${injectedScript(probe, options.timeout, callbackPath, callbackToken)}\n${marker}`);
    try {
      session = serveOutput(htmlPath, {
        html,
        htmlOnce: true,
        async fetch(request) {
          const url = new URL(request.url);
          if (url.pathname !== callbackPath) return undefined;
          if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
          if (request.headers.get("x-mdxx-check-token") !== callbackToken) return new Response("Forbidden", { status: 403 });
          const body = await readBoundedBody(request);
          if (body === undefined) return new Response("Result too large", { status: 413 });
          let message: unknown;
          try {
            message = JSON.parse(body);
          } catch {
            return new Response("Invalid JSON", { status: 400 });
          }
          const accepted = acceptCallback(message, request.headers.get("x-mdxx-check-token"), callbackToken, protocol);
          if (accepted.result) resolveResult(accepted.result);
          return new Response(accepted.status === 204 ? null : "Invalid callback protocol", { status: accepted.status });
        },
      });
    } catch (error) {
      return {
        ok: false,
        phase: "setup",
        error: { message: error instanceof Error ? error.message : String(error) },
        console: [],
      };
    }

    try {
      browser = Bun.spawn([
        options.browser,
        "--headless",
        "--no-sandbox",
        "--disable-gpu",
        "--enable-logging=stderr",
        `--user-data-dir=${profile}`,
        session.url,
      ], { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
    } catch (error) {
      return {
        ok: false,
        phase: "setup",
        error: { message: error instanceof Error ? error.message : String(error) },
        console: [],
      };
    }

    const child = browser;
    diagnostics = drainBrowserDiagnostics(child.stderr);
    const watchdog = new Promise<"timeout">((resolve) => {
      timeout = setTimeout(() => resolve("timeout"), options.timeout + 1_000);
    });
    const interrupted = new Promise<"interrupted">((resolve) => {
      if (options.signal?.aborted) resolve("interrupted");
      else options.signal?.addEventListener("abort", () => resolve("interrupted"), { once: true });
    });
    const outcome = await Promise.race([
      received.then((result) => ({ type: "result" as const, result })),
      child.exited.then((exitCode) => ({ type: "exit" as const, exitCode })),
      watchdog.then(() => ({ type: "timeout" as const })),
      interrupted.then(() => ({ type: "interrupted" as const })),
    ]);
    await terminate(child);
    const drained = await Promise.race([diagnostics.done.then(() => true), Bun.sleep(500).then(() => false)]);
    if (!drained) await diagnostics.cancel();
    const console = diagnostics.lines;
    if (outcome.type === "result") return { ...outcome.result, console };
    if (outcome.type === "interrupted") throw new MdxxError("INTERRUPTED", "check interrupted");
    return {
      ok: false,
      phase: protocol.mounted ? "probe" : "mount",
      error: {
        message: outcome.type === "timeout"
          ? `check timed out after ${options.timeout}ms`
          : `browser exited with code ${outcome.exitCode}`,
      },
      console,
    };
  } finally {
    clearTimeout(timeout);
    if (browser) await Promise.allSettled([terminate(browser)]);
    if (diagnostics) await Promise.allSettled([diagnostics.cancel()]);
    await Promise.allSettled([
      session?.close() ?? Promise.resolve(),
      rm(profile, { recursive: true, force: true }),
    ]);
  }
}
