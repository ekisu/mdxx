import type { Element, Root, Text } from "hast";
import type { Plugin } from "unified";

function textContent(node: Element): string {
  return node.children
    .filter((child): child is Text => child.type === "text")
    .map((child) => child.value)
    .join("");
}

export const rehypeMermaid: Plugin<[], Root> = () => (tree) => {
  const visit = (node: Root | Element): void => {
    for (let index = 0; index < node.children.length; index += 1) {
      const child = node.children[index];
      if (child?.type !== "element") continue;
      const code = child.tagName === "pre" && child.children[0]?.type === "element" ? child.children[0] : undefined;
      const classes = code?.properties.className;
      if (code?.tagName === "code" && Array.isArray(classes) && classes.includes("language-mermaid")) {
        node.children[index] = {
          type: "element",
          tagName: "div",
          properties: { className: ["mermaid"], dataMdxxMermaid: "" },
          children: [{ type: "text", value: textContent(code) }],
        };
      } else {
        visit(child);
      }
    }
  };
  visit(tree);
};

export function containsMermaid(source: string): boolean {
  return /^ {0,3}(?:`{3,}|~{3,})[ \t]*mermaid(?:[ \t]|$)/im.test(source);
}
