interface MarkdownNode {
  type: string;
  lang?: string | null;
  value?: string;
  children?: MarkdownNode[];
  [key: string]: unknown;
}

interface MermaidPluginOptions {
  features?: Set<string>;
}

export function remarkMermaid({ features }: MermaidPluginOptions = {}) {
  return (tree: MarkdownNode): void => {
    const visit = (node: MarkdownNode): void => {
      if (!node.children) return;
      for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index];
        if (!child) continue;
        if (child.type === "code" && child.lang?.toLowerCase() === "mermaid") {
          features?.add("mermaid");
          node.children[index] = {
            type: "mdxJsxFlowElement",
            name: "MermaidDiagram",
            attributes: [{ type: "mdxJsxAttribute", name: "source", value: child.value ?? "" }],
            children: [],
          };
        } else {
          visit(child);
        }
      }
    };
    visit(tree);
  };
}
