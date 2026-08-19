export function clientEntry(documentPath: string): string {
  return `
import {createElement} from "react";
import {createRoot} from "react-dom/client";
import Content from ${JSON.stringify(documentPath)};

function report(error) {
  const message = error instanceof Error ? error.message : String(error);
  document.documentElement.dataset.mdxxError = message;
  console.error("mdxx: browser startup failed", error);
}

addEventListener("error", event => report(event.error || event.message));
addEventListener("unhandledrejection", event => report(event.reason));

try {
  const root = document.getElementById("mdxx-root");
  const data = document.getElementById("mdxx-data");
  if (!root || !data) throw new Error("Invalid mdxx HTML shell");
  const {metadata} = JSON.parse(data.textContent || "{}");
  createRoot(root).render(createElement(Content, {metadata}));
} catch (error) {
  report(error);
}
`;
}
