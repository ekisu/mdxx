import { compile } from "@mdx-js/mdx";
import { parseDocument } from "../document/parse.ts";
import { MdxxError } from "../shared/errors.ts";
import type { AssetReference } from "../assets/discover.ts";

function rewriteReferences(path: string, source: string, references: AssetReference[], urls: Map<string, string>): string {
  let result = source;
  for (const reference of references) {
    if (reference.importer !== path || !reference.resolved) continue;
    const url = urls.get(reference.resolved);
    if (url) result = result.replaceAll(reference.specifier, url);
  }
  return result;
}

export async function compileMdx(
  path: string,
  source: string,
  references: AssetReference[] = [],
  urls: Map<string, string> = new Map(),
): Promise<string> {
  let document;
  try {
    document = parseDocument(source);
    document.body = rewriteReferences(path, document.body, references, urls);
  } catch (cause) {
    throw new MdxxError("INVALID_MDX", `could not parse ${path}`, { cause });
  }

  try {
    return String(
      await compile(
        { value: document.body, path },
        {
          outputFormat: "program",
          jsxRuntime: "automatic",
          jsxImportSource: "react",
          development: false,
        },
      ),
    );
  } catch (cause) {
    throw new MdxxError("INVALID_MDX", `could not compile ${path}`, { cause });
  }
}

export function mdxPlugin(references: AssetReference[] = [], urls: Map<string, string> = new Map()): Bun.BunPlugin {
  return {
    name: "mdxx-mdx",
    setup(builder) {
      builder.onLoad({ filter: /\.mdx$/ }, async ({ path }) => ({
        contents: await compileMdx(path, await Bun.file(path).text(), references, urls),
        loader: "js",
      }));
    },
  };
}
