import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { build } from "./build.ts";

export interface RunSession {
  url: string;
  close(): Promise<void>;
}

export async function startRun(path: string, locked = false): Promise<RunSession> {
  const temporary = await mkdtemp(join(tmpdir(), "mdxx-run-"));
  try {
    const htmlPath = await build(path, { output: join(temporary, "output"), locked });
    const root = dirname(htmlPath);
    const htmlName = basename(htmlPath);
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const pathname = decodeURIComponent(new URL(request.url).pathname);
        const relative = pathname === "/" ? htmlName : pathname.replace(/^\/+/, "");
        const filePath = resolve(root, relative);
        if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) return new Response("Not found", { status: 404 });
        const file = Bun.file(filePath);
        if (!(await file.exists())) return new Response("Not found", { status: 404 });
        return new Response(file);
      },
    });
    let closed = false;
    return {
      url: `http://${server.hostname}:${server.port}/`,
      async close() {
        if (closed) return;
        closed = true;
        await server.stop(true);
        await rm(temporary, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function run(path: string, locked = false): Promise<void> {
  const session = await startRun(path, locked);
  console.log(session.url);
  await new Promise<void>((resolveSignal) => {
    const stop = (): void => resolveSignal();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  await session.close();
}
