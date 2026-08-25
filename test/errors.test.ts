import { expect, test } from "bun:test";
import { join } from "node:path";
import { main } from "../src/cli.ts";
import { formatError, MdxxError, sourceDiagnostic } from "../src/shared/errors.ts";

test("formats a source diagnostic and its help", () => {
  const cause = Object.assign(new SyntaxError("Unexpected token (2:6)"), {
    loc: { line: 2, column: 6 },
  });
  const source = "const valid = true;\nconst value = ;\n";
  const error = new MdxxError("INVALID_MODULE", "could not parse example.ts", {
    cause,
    diagnostic: sourceDiagnostic(cause, "example.ts", source),
    help: "Fix the module syntax at the highlighted location.",
  });

  expect(formatError(error)).toBe([
    "mdxx: INVALID_MODULE: could not parse example.ts",
    "  --> example.ts:2:7",
    "  1 | const valid = true;",
    "> 2 | const value = ;",
    "    |       ^ Unexpected token",
    "  3 |",
    "  help: Fix the module syntax at the highlighted location.",
  ].join("\n"));
});

test("verify reports an MDX code frame at the document line", async () => {
  const directory = (await Bun.$`mktemp -d`.text()).trim();
  const path = join(directory, "invalid.mdx");
  const errors: string[] = [];
  const original = console.error;
  try {
    await Bun.write(path, "---\nmdxx:\n  format: 1\n---\n\n<Component>\n");
    console.error = (message?: unknown) => errors.push(String(message));

    expect(await main(["verify", path])).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("mdxx: INVALID_MDX");
    expect(errors[0]).toContain(`--> ${path}:6:1`);
    expect(errors[0]).toContain("> 6 | <Component>");
    expect(errors[0]).toContain("Expected a closing tag for `<Component>`");
    expect(errors[0]).toContain("help: Fix the MDX syntax at the highlighted location.");
  } finally {
    console.error = original;
    await Bun.$`rm -rf ${directory}`;
  }
});
