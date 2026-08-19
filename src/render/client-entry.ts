export function clientEntry(documentPath: string, mermaid: boolean): string {
  const mermaidRuntime = mermaid
    ? `
function ClientRoot() {
  useEffect(() => {
    async function renderMermaid() {
      try {
        const mermaid = globalThis.__mdxxMermaid;
        if (!mermaid) throw new Error("Mermaid runtime is unavailable");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          deterministicIds: true,
          deterministicIDSeed: "mdxx",
          theme: "dark",
        });
        await mermaid.run({nodes: document.querySelectorAll(".mermaid")});
      } catch (error) {
        document.documentElement.dataset.mdxxMermaidError = error instanceof Error ? error.message : String(error);
        console.error("mdxx: Mermaid rendering failed", error);
      }
    }
    void renderMermaid();
  }, []);
  return createElement(Content, {metadata});
}
`
    : `
function ClientRoot() {
  return createElement(Content, {metadata});
}
`;
  return `
import {createElement, useEffect} from "react";
import {hydrateRoot} from "react-dom/client";
import Content from ${JSON.stringify(documentPath)};

const root = document.getElementById("mdxx-root");
const data = document.getElementById("mdxx-data");
if (!root || !data) throw new Error("Invalid mdxx HTML shell");
const {metadata} = JSON.parse(data.textContent || "{}");
${mermaidRuntime}
hydrateRoot(root, createElement(ClientRoot), {identifierPrefix: "mdxx-"});
`;
}
