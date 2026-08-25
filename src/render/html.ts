import { canonicalJson } from "../shared/canonical-json.ts";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function scriptSafe(value: string): string {
  return value
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export interface HtmlInput {
  metadata: Record<string, unknown>;
  scripts: string[];
  styles: string[];
}

const startupRuntime = `(() => {
  const shell = document.documentElement;
  let phase = "loading";
  function details(error, seen = new Set()) {
    if (error instanceof Error) {
      if (seen.has(error)) return {name: error.name, message: error.message, circular: true};
      seen.add(error);
      return {
        name: error.name,
        message: error.message,
        ...(error.stack ? {stack: error.stack} : {}),
        ...(error.cause === undefined ? {} : {cause: details(error.cause, seen)}),
      };
    }
    return {message: String(error)};
  }
  function result(value) {
    const json = JSON.stringify(value);
    shell.dataset.mdxxResult = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  }
  function state(value) {
    phase = value;
    shell.dataset.mdxxState = value;
  }
  function report(error, errorPhase = phase) {
    const diagnostic = details(error);
    shell.dataset.mdxxError = diagnostic.message;
    state("error");
    result({ok: false, state: "error", phase: errorPhase, error: diagnostic});
    const root = document.getElementById("mdxx-root");
    if (root) {
      root.removeAttribute("aria-busy");
      root.replaceChildren(Object.assign(document.createElement("pre"), {textContent: "mdxx failed during " + errorPhase + ": " + diagnostic.message}));
    }
    console.error("mdxx: browser startup failed during " + errorPhase, error);
  }
  globalThis.__mdxxRuntime = {report, result, state};
  addEventListener("error", event => report(event.error || new Error(event.message || "Browser resource failed to load")));
  addEventListener("unhandledrejection", event => report(event.reason));
})();`;

export function createHtml({ metadata, scripts, styles }: HtmlInput): string {
  const title = typeof metadata.title === "string" ? metadata.title : "mdxx document";
  const links = styles.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`).join("\n");
  const data = scriptSafe(canonicalJson({ metadata }));
  const entries = scripts.map((src) => `<script type="module" src="${escapeHtml(src)}"></script>`).join("\n");
  return `<!doctype html>
<html lang="en" data-mdxx-state="loading">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>${links ? `\n${links}` : ""}
<style>@media (prefers-color-scheme: dark) {
  .shiki, .shiki span {
    color: var(--shiki-dark) !important;
    background-color: var(--shiki-dark-bg) !important;
    font-style: var(--shiki-dark-font-style) !important;
    font-weight: var(--shiki-dark-font-weight) !important;
    text-decoration: var(--shiki-dark-text-decoration) !important;
  }
}</style>
</head>
<body>
<main id="mdxx-root"></main>
<noscript>This interactive visualization requires JavaScript.</noscript>
<script id="mdxx-data" type="application/json">${data}</script>
<script>${startupRuntime}</script>
${entries}
</body>
</html>
`;
}
