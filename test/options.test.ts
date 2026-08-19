import { expect, test } from "bun:test";
import { main } from "../src/cli.ts";

test("rejects unknown and command-specific options", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    expect(await main(["inspect", "--bogus", "document.mdx"])).toBe(1);
    expect(await main(["init", "--locked", "document.mdx"])).toBe(1);
    expect(await main(["verify", "--output", "out", "document.mdx"])).toBe(1);
  } finally {
    console.error = original;
  }
});
