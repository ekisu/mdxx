import { isAlias, parseDocument, visit } from "yaml";
import { MdxxError } from "../shared/errors.ts";
import { validateFrontmatter, type FrontmatterData } from "./schema.ts";

export interface ParsedFrontmatter extends FrontmatterData {
  body: string;
  bodyLineOffset: number;
  raw: string;
}

export function parseFrontmatter(source: string): ParsedFrontmatter {
  const firstBreak = source.indexOf("\n");
  const firstLine = (firstBreak === -1 ? source : source.slice(0, firstBreak)).replace(/\r$/, "");
  if (firstLine !== "---") {
    throw new MdxxError("MISSING_FRONTMATTER", "document must begin with YAML frontmatter");
  }

  const fence = /^---\r?$/gm;
  fence.lastIndex = firstBreak + 1;
  const closing = fence.exec(source);
  if (!closing) {
    throw new MdxxError("INVALID_FRONTMATTER", "frontmatter is missing its closing fence");
  }

  const raw = source.slice(firstBreak + 1, closing.index);
  const bodyStart = closing.index + closing[0].length;
  const body = source.slice(bodyStart).replace(/^\r?\n/, "");
  const bodyLineOffset = source.slice(0, closing.index).split(/\r?\n/).length;
  const document = parseDocument(raw, {
    schema: "core",
    uniqueKeys: true,
    customTags: [],
    prettyErrors: true,
  });

  if (document.errors.length > 0) {
    throw new MdxxError("INVALID_FRONTMATTER", document.errors[0]?.message ?? "invalid YAML");
  }
  if (document.warnings.length > 0) {
    throw new MdxxError("INVALID_FRONTMATTER", document.warnings[0]?.message ?? "invalid YAML");
  }

  let forbidden: "anchor" | "alias" | undefined;
  visit(document, (_key, node) => {
    if (isAlias(node)) forbidden = "alias";
    if (node !== null && typeof node === "object" && "anchor" in node && node.anchor) forbidden = "anchor";
  });
  if (forbidden) {
    throw new MdxxError("INVALID_FRONTMATTER", `YAML ${forbidden}s are not supported`);
  }

  const data = validateFrontmatter(document.toJS({ maxAliasCount: 0 }));
  return { ...data, body, bodyLineOffset, raw };
}
