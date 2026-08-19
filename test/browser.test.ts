import { expect, test } from "bun:test";
import { join } from "node:path";
import { Window } from "happy-dom";
import { build } from "../src/commands/build.ts";
import { startRun } from "../src/commands/run.ts";

test("mounts plain MDX in Chromium without build-time evaluation", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const document = join(directory, "browser.mdx");
  try {
    await Bun.write(
      document,
      "---\nmdxx:\n  format: 1\n---\n\n# Browser mounted\n\n{typeof window === 'object' ? 'browser only' : (() => { throw new Error('build evaluated document') })()}\n",
    );
    const session = await startRun(document);
    try {
      const process = Bun.spawn(
        ["chromium", "--headless", "--no-sandbox", "--disable-gpu", "--virtual-time-budget=2000", "--dump-dom", session.url],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [code, html] = await Promise.all([process.exited, process.stdout.text(), process.stderr.text()]);
      expect(code).toBe(0);
      expect(html).toContain("<h1>Browser mounted</h1>");
      expect(html).toContain("browser only");
      expect(html).not.toContain("data-mdxx-error");
    } finally {
      await session.close();
    }
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);

test("mounts interactive state and responds to input", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const documentPath = join(directory, "counter.mdx");
  const window = new Window({ url: "http://127.0.0.1/" });
  const globals = globalThis as Record<string, unknown>;
  const replacements: Record<string, unknown> = {
    window,
    document: window.document,
    navigator: window.navigator,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    SVGElement: window.SVGElement,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    addEventListener: window.addEventListener.bind(window),
  };
  const previous = new Map(Object.keys(replacements).map((key) => [key, globals[key]]));
  try {
    await Bun.write(
      documentPath,
      `---
mdxx:
  format: 1
---

import {useState} from 'react'
export function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(value => value + 1)}>{count}</button>
}

<Counter />
`,
    );
    const htmlPath = await build(documentPath, { output: join(directory, "output") });
    const html = await Bun.file(htmlPath).text();
    const src = html.match(/<script type="module" src="([^"]+)"/i)?.[1];
    if (!src) throw new Error("client entry not found");
    window.document.write(html);
    Object.assign(globals, replacements);
    await import(`${join(directory, "output", src)}?test=${crypto.randomUUID()}`);
    await Bun.sleep(20);

    const button = window.document.querySelector("button");
    expect(button?.textContent).toBe("0");
    button?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await Bun.sleep(20);
    expect(button?.textContent).toBe("1");
  } finally {
    for (const [key, value] of previous) globals[key] = value;
    await window.close();
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);

test("renders React Flow, Visx, and react-minimal-pie-chart through ordinary imports", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const document = join(directory, "visualizations.mdx");
  try {
    await Bun.write(
      document,
      `---
mdxx:
  format: 1
---

import {ReactFlow} from '@xyflow/react@12.11.3'
import '@xyflow/react@12.11.3/dist/style.css'
import {Bar} from '@visx/shape@4.0.0'
import {PieChart} from 'react-minimal-pie-chart@9.1.2'

<div data-fixture="react-flow" style={{width: 400, height: 220}}>
  <ReactFlow nodes={[{id: 'one', position: {x: 20, y: 20}, data: {label: 'Flow node'}}]} edges={[]} fitView />
</div>
<svg data-fixture="visx" width="120" height="60"><Bar x={10} y={10} width={100} height={40} fill="tomato" /></svg>
<div data-fixture="pie" style={{width: 120}}><PieChart data={[{title: 'A', value: 60, color: '#09f'}, {title: 'B', value: 40, color: '#fc0'}]} /></div>
`,
    );
    const session = await startRun(document);
    try {
      const process = Bun.spawn(
        ["chromium", "--headless", "--no-sandbox", "--disable-gpu", "--virtual-time-budget=2000", "--dump-dom", session.url],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [code, html] = await Promise.all([process.exited, process.stdout.text(), process.stderr.text()]);
      expect(code).toBe(0);
      expect(html).toContain('data-fixture="react-flow"');
      expect(html).toContain("react-flow__node");
      expect(html).toContain('data-fixture="visx"');
      expect(html).toContain('fill="tomato"');
      expect(html).toContain('data-fixture="pie"');
      expect(html).not.toContain("data-mdxx-error");
    } finally {
      await session.close();
    }
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 60_000);

test("serves static dynamic-import chunks", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const document = join(directory, "dynamic.mdx");
  try {
    await Bun.write(join(directory, "lazy.ts"), "export const value = 'dynamic chunk loaded'\n");
    await Bun.write(
      document,
      `---
mdxx:
  format: 1
---

import {useEffect, useState} from 'react'
export function Dynamic() {
  const [value, setValue] = useState('loading')
  useEffect(() => { import('./lazy.ts').then(module => setValue(module.value)) }, [])
  return <p>{value}</p>
}

<Dynamic />
`,
    );
    const session = await startRun(document);
    try {
      const process = Bun.spawn(
        ["chromium", "--headless", "--no-sandbox", "--disable-gpu", "--virtual-time-budget=2000", "--dump-dom", session.url],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [code, html] = await Promise.all([process.exited, process.stdout.text(), process.stderr.text()]);
      expect(code).toBe(0);
      expect(html).toContain("dynamic chunk loaded");
      expect(html).not.toContain("data-mdxx-error");
    } finally {
      await session.close();
    }
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);

test("serves browser workers and WASM from the output graph", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const document = join(directory, "worker.mdx");
  try {
    await Bun.write(join(directory, "worker.ts"), "self.onmessage = () => postMessage('worker loaded')\n");
    await Bun.write(join(directory, "empty.wasm"), new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    await Bun.write(
      document,
      `---
mdxx:
  format: 1
---

import {useEffect, useState} from 'react'
import wasmUrl from './empty.wasm'
export function WorkerResult() {
  const [value, setValue] = useState('loading')
  useEffect(() => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {type: 'module'})
    const message = new Promise(resolve => { worker.onmessage = resolve })
    worker.postMessage(null)
    Promise.all([message, WebAssembly.instantiateStreaming(fetch(wasmUrl))]).then(() => setValue('worker and wasm loaded'))
    return () => worker.terminate()
  }, [])
  return <p>{value}</p>
}

<WorkerResult />
`,
    );
    const session = await startRun(document);
    try {
      const process = Bun.spawn(
        ["chromium", "--headless", "--no-sandbox", "--disable-gpu", "--virtual-time-budget=2000", "--dump-dom", session.url],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [code, html] = await Promise.all([process.exited, process.stdout.text(), process.stderr.text()]);
      expect(code).toBe(0);
      expect(html).toContain("worker and wasm loaded");
      expect(html).not.toContain("data-mdxx-error");
    } finally {
      await session.close();
    }
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);

test("mounts the flagship microgrid visualization stack", async () => {
  const document = join(import.meta.dir, "../examples/northstar-microgrid/document.mdx");
  const session = await startRun(document);
  try {
    const process = Bun.spawn(
      ["chromium", "--headless", "--no-sandbox", "--disable-gpu", "--virtual-time-budget=3000", "--dump-dom", session.url],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [code, html] = await Promise.all([process.exited, process.stdout.text(), process.stderr.text()]);
    expect(code).toBe(0);
    expect(html).toContain("Power after the");
    expect(html).toContain("react-flow__node");
    expect(html).toContain("<canvas");
    expect(html).not.toContain("data-mdxx-error");
  } finally {
    await session.close();
  }
}, 60_000);

test("mounts the self-contained vanilla graph without a stylesheet", async () => {
  const document = join(import.meta.dir, "../examples/vanilla-graph/document.mdx");
  const session = await startRun(document);
  try {
    const process = Bun.spawn(
      ["chromium", "--headless", "--no-sandbox", "--disable-gpu", "--virtual-time-budget=1000", "--dump-dom", session.url],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [code, html] = await Promise.all([process.exited, process.stdout.text(), process.stderr.text()]);
    expect(code).toBe(0);
    expect(html).toContain("<h1>A small project graph</h1>");
    expect(html).toContain("Interactive project delivery graph");
    expect(html).toContain("<table>");
    expect(html).toContain("max-width: 52rem");
    expect(html).not.toContain('rel="stylesheet"');
    expect(html).not.toContain("data-mdxx-error");
  } finally {
    await session.close();
  }
}, 30_000);
