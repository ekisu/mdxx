import { describe, expect, test } from "bun:test";
import { appendEmbeddedLock, extractEmbeddedLock, serializeEmbeddedLock } from "../src/document/embedded-lock.ts";
import { parseDocument } from "../src/document/parse.ts";
import { normalizeInlineStyles } from "../src/document/inline-style.ts";

const source = `---
title: Example
mdxx:
  format: 1
---

# Hello
`;

describe("document parsing", () => {
  test("normalizes raw style blocks without changing JSX expressions", () => {
    expect(normalizeInlineStyles("<style media=\"screen\">body { margin: 0; }</style>")).toBe(
      '<style media="screen">{"body { margin: 0; }"}</style>',
    );
    expect(normalizeInlineStyles("<style>{styles}</style>")).toBe("<style>{styles}</style>");
  });

  test("parses metadata and defaults interactive rendering", () => {
    const parsed = parseDocument(source);
    expect(parsed.metadata).toEqual({ title: "Example" });
    expect(parsed.config.render.mode).toBe("interactive");
    expect(parsed.body).toBe("\n# Hello\n");
  });

  test("rejects duplicate keys", () => {
    expect(() => parseDocument(source.replace("title: Example", "title: One\ntitle: Two"))).toThrow("Map keys must be unique");
  });

  test("rejects tags, anchors, and aliases", () => {
    expect(() => parseDocument(source.replace("title: Example", "title: !env HOME"))).toThrow();
    expect(() => parseDocument(source.replace("title: Example", "title: &name Example\ncopy: *name"))).toThrow();
  });

  test("rejects unsupported format and mode", () => {
    expect(() => parseDocument(source.replace("format: 1", "format: 2"))).toThrow("mdxx.format must be 1");
    expect(() => parseDocument(source.replace("format: 1", "format: 1\n  render:\n    mode: static"))).toThrow("must be interactive");
  });

  test("validates the required CLI version", () => {
    expect(() => parseDocument(source.replace("format: 1", 'format: 1\n  requires: "not a range"'))).toThrow("valid semver range");
    expect(() => parseDocument(source.replace("format: 1", 'format: 1\n  requires: ">=1"'))).toThrow("current version is 0.2.0");
  });

  test("tracks fresh and stale locks", () => {
    const digest = parseDocument(source).sourceDigest;
    const locked = appendEmbeddedLock(source, { sourceDigest: digest, packages: [] });
    expect(parseDocument(locked).lockFresh).toBe(true);
    expect(parseDocument(locked.replace("# Hello", "# Changed")).lockFresh).toBe(false);
  });

  test("source digest is stable after lock removal", () => {
    const first = parseDocument(source);
    const locked = appendEmbeddedLock(source, { sourceDigest: first.sourceDigest, packages: [] });
    expect(parseDocument(locked).sourceDigest).toBe(first.sourceDigest);
    expect(extractEmbeddedLock(locked).source).toBe(source);
  });

  test("canonical locks sort keys and escape comment terminators", () => {
    const lock = serializeEmbeddedLock({
      sourceDigest: `sha256-${"0".repeat(64)}`,
      z: "https://example.test/*/payload",
      a: 1,
    });
    expect(lock.indexOf('"a"')).toBeLessThan(lock.indexOf('"z"'));
    expect(lock).not.toContain("*/payload");
    expect(extractEmbeddedLock(`${source}${lock}`).lock?.z).toBe("https://example.test/*/payload");
  });

  test("rejects malformed or non-terminal lock markers", () => {
    expect(() => extractEmbeddedLock(`${source}{/* @mdxx-lock v1\n{}\n*/}\nmore`)).toThrow("trailing lock block");
    expect(() => extractEmbeddedLock(`${source}{/* @mdxx-lock v1\n{}\n*/}`)).toThrow("sourceDigest");
  });
});
