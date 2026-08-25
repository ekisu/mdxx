export function clientEntry(documentPath: string, features: string[] = []): string {
  const hasMermaid = features.includes("mermaid");
  const reactImports = hasMermaid ? "createElement, useEffect, useId, useRef" : "createElement";
  const mermaidRuntime = hasMermaid
    ? `
    const mermaid = globalThis.mermaid;
    if (!mermaid) throw new Error("Mermaid runtime is unavailable");
mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  deterministicIds: true,
  deterministicIDSeed: "mdxx",
});

function MermaidDiagram({source}) {
  const container = useRef(null);
  const id = useId().replace(/[^A-Za-z0-9_-]/g, "");
  useEffect(() => {
    const element = container.current;
    let cancelled = false;
    async function draw() {
      try {
        if (!element) return;
        const {svg, bindFunctions} = await mermaid.render("mdxx-mermaid-" + id, source, element);
        if (cancelled) return;
        element.innerHTML = svg;
        bindFunctions?.(element);
      } catch (error) {
        if (!cancelled) report(error);
      }
    }
    void draw();
    return () => {
      cancelled = true;
      element?.replaceChildren();
    };
  }, [id, source]);
  return createElement("div", {className: "mdxx-mermaid", ref: container, role: "img", "aria-label": "Mermaid diagram"});
}
`
    : "";
  const contentProps = hasMermaid ? "{metadata, components: {MermaidDiagram}}" : "{metadata}";
  return `
import {${reactImports}} from "react";
import {flushSync} from "react-dom";
import {createRoot} from "react-dom/client";
import Content from ${JSON.stringify(documentPath)};

const shell = document.documentElement;
const runtime = globalThis.__mdxxRuntime ?? {
  state(value) { shell.dataset.mdxxState = value; },
  result() {},
  report(error) {
    shell.dataset.mdxxState = "error";
    shell.dataset.mdxxError = error instanceof Error ? error.message : String(error);
    console.error("mdxx: browser startup failed", error);
  },
};
const {report, result, state} = runtime;

async function bootstrap() {
 try {
  const root = document.getElementById("mdxx-root");
  const data = document.getElementById("mdxx-data");
  if (!root || !data) throw new Error("Invalid mdxx HTML shell");
  root.setAttribute("aria-busy", "true");
  const {metadata} = JSON.parse(data.textContent || "{}");
  state("mounting");
${mermaidRuntime}
  const reactRoot = createRoot(root, {onUncaughtError: error => report(error)});
  flushSync(() => reactRoot.render(createElement(Content, ${contentProps})));
  if (shell.dataset.mdxxState === "error") return;
  root.removeAttribute("aria-busy");
  state("mounted");
  result({ok: true, state: "mounted", phase: "mounted"});
 } catch (error) {
   report(error);
 }
}

void bootstrap();
`;
}
