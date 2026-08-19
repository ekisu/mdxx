import { compile } from "@mdx-js/mdx";
import { parseDocument } from "../document/parse.ts";
import { MdxxError } from "../shared/errors.ts";
import type { AssetReference } from "../assets/discover.ts";
import { transpileMdxEsm } from "../document/typescript.ts";

function rewriteReferences(path: string, source: string, references: AssetReference[], urls: Map<string, string>): string {
  let result = source;
  for (const reference of references) {
    if (reference.importer !== path || !reference.resolved || reference.imported) continue;
    const url = urls.get(reference.resolved);
    if (!url) continue;
    const escaped = reference.specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result
      .replace(new RegExp(`(\\]\\(\\s*<?)${escaped}(>?)(?=[\\s)])`, "g"), `$1${url}$2`)
      .replace(new RegExp(`((?:src|poster|srcSet)\\s*=\\s*["'])${escaped}(["'])`, "g"), `$1${url}$2`)
      .replace(new RegExp(`((?:src|poster)\\s*=\\s*\\{\\s*["'])${escaped}(["']\\s*\\})`, "g"), `$1${url}$2`)
      .replace(new RegExp(`(^\\s*\\[[^\\]]+\\]:\\s*<?)${escaped}(>?)`, "gm"), `$1${url}$2`);
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
    document.body = transpileMdxEsm(rewriteReferences(path, document.body, references, urls), path);
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
