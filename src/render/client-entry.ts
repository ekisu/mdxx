export function clientEntry(documentPath: string, mermaid: boolean): string {
  const mermaidImport = mermaid ? 'import mermaid from "mermaid";' : "";
  const mermaidRuntime = mermaid
    ? `
queueMicrotask(async () => {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    deterministicIds: true,
    deterministicIDSeed: "mdxx",
    theme: "dark",
  });
  await mermaid.run({nodes: document.querySelectorAll(".mermaid")});
});`
    : "";
  return `
import {createElement} from "react";
import {hydrateRoot} from "react-dom/client";
import Content from ${JSON.stringify(documentPath)};
${mermaidImport}

const root = document.getElementById("mdxx-root");
const data = document.getElementById("mdxx-data");
if (!root || !data) throw new Error("Invalid mdxx HTML shell");
const {metadata} = JSON.parse(data.textContent || "{}");
hydrateRoot(root, createElement(Content, {metadata}), {identifierPrefix: "mdxx-"});
${mermaidRuntime}
`;
}
