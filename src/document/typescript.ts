import { transformSync } from "@babel/core";
import transformTypeScript from "@babel/plugin-transform-typescript";
import { MdxxError } from "../shared/errors.ts";

export function transpileMdxEsm(source: string, path: string): string {
  const lines = source.match(/.*(?:\r?\n|$)/g)?.filter(Boolean) ?? [];
  const output: string[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? "";
    if (!/^(?:import|export)\b/.test(line)) {
      output.push(line);
      index += 1;
      continue;
    }

    const block: string[] = [];
    while (index < lines.length && !/^\s*$/.test(lines[index] ?? "")) {
      block.push(lines[index] ?? "");
      index += 1;
    }
    try {
      const result = transformSync(block.join(""), {
        filename: path.endsWith(".mdx") ? `${path}.tsx` : path,
        babelrc: false,
        configFile: false,
        parserOpts: { sourceType: "module", plugins: ["jsx", "typescript"] },
        plugins: [[transformTypeScript, { allExtensions: true, isTSX: true, allowDeclareFields: true, onlyRemoveTypeImports: true }]],
      });
      if (result?.code) output.push(`${result.code}\n`);
    } catch (cause) {
      throw new MdxxError("INVALID_TYPESCRIPT", `could not transpile MDX ESM in ${path}`, { cause });
    }
  }
  return output.join("");
}
