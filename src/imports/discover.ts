import { extname, resolve } from "node:path";
import { compile } from "@mdx-js/mdx";
import { parse } from "@babel/parser";
import { MdxxError, sourceDiagnostic } from "../shared/errors.ts";
import { isCodePath, resolveLocalModule } from "../shared/paths.ts";
import type { ImportGraph, ImportReference } from "./graph.ts";
import { isBuiltinSpecifier, parsePackageSpecifier, type PackageSpecifier } from "./specifier.ts";
import { transpileMdxEsm } from "../document/typescript.ts";
import remarkGfm from "remark-gfm";
import { normalizeInlineStyles } from "../document/inline-style.ts";
import { remarkMermaid } from "../render/mermaid.ts";

interface SyntaxNode {
  type?: string;
  source?: { value?: unknown };
  callee?: SyntaxNode;
  arguments?: SyntaxNode[];
  name?: string;
  value?: unknown;
  [key: string]: unknown;
}

interface DiscoveredSpecifier {
  value: string;
  worker: boolean;
}

interface DocumentDiagnosticContext {
  source: string;
  bodyLineOffset: number;
}

function collectSpecifiers(root: unknown): DiscoveredSpecifier[] {
  const specifiers: DiscoveredSpecifier[] = [];
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (value === null || typeof value !== "object") continue;
    const node = value as SyntaxNode;
    if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type ?? "")) {
      if (typeof node.source?.value === "string") specifiers.push({ value: node.source.value, worker: false });
    }
    if (node.type === "ImportExpression") {
      if (typeof node.source?.value !== "string") throw new MdxxError("FORBIDDEN_IMPORT", "computed dynamic imports are not supported");
      specifiers.push({ value: node.source.value, worker: false });
    }
    if (node.type === "CallExpression" && node.callee?.type === "Import") {
      const argument = node.arguments?.[0];
      if (argument?.type !== "StringLiteral" || typeof argument.value !== "string") {
        throw new MdxxError("FORBIDDEN_IMPORT", "computed dynamic imports are not supported");
      }
      specifiers.push({ value: argument.value, worker: false });
    }
    if (node.type === "CallExpression" && node.callee?.type === "Identifier" && (node.callee as { name?: string }).name === "require") {
      throw new MdxxError("FORBIDDEN_IMPORT", "CommonJS require is not supported");
    }
    if (node.type === "NewExpression" && node.callee?.type === "Identifier" && ["Worker", "SharedWorker"].includes(node.callee.name ?? "")) {
      const url = node.arguments?.[0];
      const argument = url?.type === "NewExpression" && url.callee?.name === "URL" ? url.arguments?.[0] : undefined;
      if (argument?.type === "StringLiteral" && typeof argument.value === "string" && argument.value.startsWith(".")) {
        specifiers.push({ value: argument.value, worker: true });
      }
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) stack.push(...child);
      else if (child !== null && typeof child === "object") stack.push(child);
    }
  }
  return specifiers;
}

async function parseModule(
  path: string,
  features: Set<string>,
  mdxBody?: string,
  diagnosticContext?: DocumentDiagnosticContext,
): Promise<DiscoveredSpecifier[]> {
  let code: string;
  if (mdxBody !== undefined || extname(path).toLowerCase() === ".mdx") {
    const authoredSource = mdxBody ?? (await Bun.file(path).text());
    const diagnosticSource = diagnosticContext?.source ?? authoredSource;
    const lineOffset = diagnosticContext?.bodyLineOffset ?? 0;
    const source = normalizeInlineStyles(transpileMdxEsm(authoredSource, path, lineOffset, diagnosticSource));
    try {
      code = String(await compile(
        { value: source, path },
        { outputFormat: "program", development: false, jsx: true, remarkPlugins: [remarkGfm, [remarkMermaid, { features }]] },
      ));
    } catch (cause) {
      throw new MdxxError("INVALID_MDX", `could not compile ${path}`, {
        cause,
        diagnostic: sourceDiagnostic(cause, path, diagnosticSource, lineOffset),
        help: "Fix the MDX syntax at the highlighted location.",
      });
    }
  } else {
    code = await Bun.file(path).text();
  }

  try {
    const ast = parse(code, {
      sourceType: "module",
      plugins: ["jsx", ...(path.match(/\.(?:ts|tsx|mts)$/) ? (["typescript"] as const) : [])],
    });
    return collectSpecifiers(ast);
  } catch (cause) {
    if (cause instanceof MdxxError) throw cause;
    throw new MdxxError("INVALID_MODULE", `could not parse ${path}`, {
      cause,
      diagnostic: sourceDiagnostic(cause, path, code),
      help: "Fix the module syntax at the highlighted location.",
    });
  }
}

export async function discoverImports(
  documentPath: string,
  mdxBody: string,
  diagnosticContext?: DocumentDiagnosticContext,
): Promise<ImportGraph> {
  const entry = resolve(documentPath);
  const pending: Array<{ path: string; body?: string }> = [{ path: entry, body: mdxBody }];
  const visited = new Set<string>();
  const packages = new Map<string, PackageSpecifier>();
  const imports: ImportReference[] = [];
  const assets = new Set<string>();
  const styles = new Set<string>();
  const remoteUrls = new Set<string>();
  const features = new Set<string>();

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || visited.has(current.path)) continue;
    visited.add(current.path);

    for (const discovered of await parseModule(
      current.path,
      features,
      current.body,
      current.path === entry ? diagnosticContext : undefined,
    )) {
      const specifier = discovered.value;
      if (/^https?:\/\//.test(specifier)) {
        throw new MdxxError("FORBIDDEN_IMPORT", `remote code import is not supported: ${specifier}`);
      }
      if (isBuiltinSpecifier(specifier)) {
        throw new MdxxError("FORBIDDEN_IMPORT", `built-in import is not supported: ${specifier}`);
      }
      if (specifier.startsWith("/")) {
        throw new MdxxError("FORBIDDEN_IMPORT", `absolute import is not supported: ${specifier}`);
      }
      if (specifier.startsWith(".")) {
        const resolved = await resolveLocalModule(current.path, specifier);
        if (!resolved) {
          throw new MdxxError("MISSING_LOCAL_FILE", `cannot resolve ${specifier} from ${current.path}`, {
            help: "Add the referenced file or correct the import path.",
          });
        }
        const kind = discovered.worker ? "worker" : extname(resolved).toLowerCase() === ".css" ? "style" : isCodePath(resolved) ? "module" : "asset";
        imports.push({ importer: current.path, specifier, kind, resolved });
        if (kind === "module" || kind === "worker") pending.push({ path: resolved });
        else if (kind === "style") styles.add(resolved);
        else assets.add(resolved);
        continue;
      }

      const parsed = parsePackageSpecifier(specifier);
      packages.set(parsed.original, parsed);
      imports.push({ importer: current.path, specifier, kind: "package" });
    }
  }

  const byText = (a: string, b: string): number => a.localeCompare(b, "en");
  return {
    modules: [...visited].sort(byText),
    packages: [...packages.values()].sort((a, b) => byText(a.original, b.original)),
    imports: imports.sort((a, b) => byText(`${a.importer}\0${a.specifier}`, `${b.importer}\0${b.specifier}`)),
    assets: [...assets].sort(byText),
    styles: [...styles].sort(byText),
    remoteUrls: [...remoteUrls].sort(byText),
    features: [...features].sort(byText),
  };
}
