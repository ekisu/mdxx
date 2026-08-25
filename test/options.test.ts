import { expect, test } from "bun:test";
import { main } from "../src/cli.ts";

test("rejects unknown and command-specific options", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    expect(await main(["inspect", "--bogus", "document.mdx"])).toBe(2);
    expect(await main(["init", "--locked", "document.mdx"])).toBe(2);
    expect(await main(["verify", "--output", "out", "document.mdx"])).toBe(2);
    expect(await main(["run", "--replace", "document.mdx"])).toBe(2);
  } finally {
    console.error = original;
  }
});

test("help describes safe output replacement", async () => {
  const original = console.log;
  let help = "";
  console.log = (message) => { help += String(message); };
  try {
    expect(await main(["--help"])).toBe(0);
    expect(help).toContain("--replace");
    expect(help).toContain("failed build leaves the existing output unchanged");
  } finally {
    console.log = original;
  }
});
