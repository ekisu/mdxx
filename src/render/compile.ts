import { compile } from "@mdx-js/mdx";
import { parseDocument } from "../document/parse.ts";
import { MdxxError } from "../shared/errors.ts";

export async function compileMdx(path: string, source: string): Promise<string> {
  let document;
  try {
    document = parseDocument(source);
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

export function mdxPlugin(): Bun.BunPlugin {
  return {
    name: "mdxx-mdx",
    setup(builder) {
      builder.onLoad({ filter: /\.mdx$/ }, async ({ path }) => ({
        contents: await compileMdx(path, await Bun.file(path).text()),
        loader: "js",
      }));
    },
  };
}
