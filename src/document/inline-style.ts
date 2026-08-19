export function normalizeInlineStyles(source: string): string {
  return source.replace(/<style(\s[^>]*)?>([\s\S]*?)<\/style>/gi, (element, attributes = "", contents: string) => {
    if (contents.trimStart().startsWith("{")) return element;
    return `<style${attributes}>{${JSON.stringify(contents)}}</style>`;
  });
}
