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

export function createHtml({ metadata, scripts, styles }: HtmlInput): string {
  const title = typeof metadata.title === "string" ? metadata.title : "mdxx document";
  const links = styles.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`).join("\n");
  const data = scriptSafe(canonicalJson({ metadata }));
  const entries = scripts.map((src) => `<script type="module" src="${escapeHtml(src)}"></script>`).join("\n");
  return `<!doctype html>
<html lang="en">
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
${entries}
</body>
</html>
`;
}
