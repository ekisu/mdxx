import { expect, test } from "bun:test";
import { join } from "node:path";
import { Window } from "happy-dom";
import { build } from "../src/commands/build.ts";

test("hydrates interactive state", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const documentPath = join(directory, "counter.mdx");
  const clientPath = join(directory, "client.mjs");
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
    const match = html.match(/<script type="module">([\s\S]*)<\/script>/);
    if (!match?.[1]) throw new Error("client bundle not found");
    window.document.write(html.replace(/<script type="module">[\s\S]*<\/script>/, ""));
    Object.assign(globals, replacements);
    await Bun.write(clientPath, match[1]);
    await import(`${clientPath}?test=${crypto.randomUUID()}`);
    await Bun.sleep(10);

    const button = window.document.querySelector("button");
    expect(button?.textContent).toBe("0");
    button?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await Bun.sleep(10);
    expect(button?.textContent).toBe("1");
  } finally {
    for (const [key, value] of previous) globals[key] = value;
    await window.close();
    await Bun.$`rm -rf ${directory}`;
  }
}, 30_000);
