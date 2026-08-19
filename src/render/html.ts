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
  markup: string;
  metadata: Record<string, unknown>;
  clientJavaScript: string;
  css: string[];
}

export function createHtml({ markup, metadata, clientJavaScript, css }: HtmlInput): string {
  const title = typeof metadata.title === "string" ? metadata.title : "mdxx document";
  const styles = css.map((style) => `<style>${style.replaceAll("</style", "<\\/style")}</style>`).join("\n");
  const data = scriptSafe(JSON.stringify({ metadata }));
  const script = clientJavaScript.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>${styles ? `\n${styles}` : ""}
</head>
<body>
<main id="mdxx-root">${markup}</main>
<script id="mdxx-data" type="application/json">${data}</script>
<script type="module">${script}</script>
</body>
</html>
`;
}
