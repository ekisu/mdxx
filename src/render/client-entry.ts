export function clientEntry(documentPath: string): string {
  return `
import {createElement} from "react";
import {hydrateRoot} from "react-dom/client";
import Content from ${JSON.stringify(documentPath)};

const root = document.getElementById("mdxx-root");
const data = document.getElementById("mdxx-data");
if (!root || !data) throw new Error("Invalid mdxx HTML shell");
const {metadata} = JSON.parse(data.textContent || "{}");
hydrateRoot(root, createElement(Content, {metadata}), {identifierPrefix: "mdxx-"});
`;
}
