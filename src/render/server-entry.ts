export function serverEntry(documentPath: string): string {
  return `
import {createElement} from "react";
import {renderToString} from "react-dom/server";
import Content from ${JSON.stringify(documentPath)};

const request = JSON.parse(await Bun.stdin.text());
try {
  const markup = renderToString(createElement(Content, {metadata: request.metadata}), {
    identifierPrefix: "mdxx-",
  });
  process.stdout.write("\\n" + request.token + JSON.stringify({ok: true, markup}) + "\\n");
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stdout.write("\\n" + request.token + JSON.stringify({ok: false, error: message}) + "\\n");
  process.exitCode = 1;
}
`;
}
