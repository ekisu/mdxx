import { sha256 } from "../shared/digest.ts";
import { extractEmbeddedLock, type EmbeddedLock } from "./embedded-lock.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import type { MdxxConfig } from "./schema.ts";

export interface ParsedDocument {
  source: string;
  body: string;
  sourceDigest: string;
  metadata: Record<string, unknown>;
  frontmatter: Record<string, unknown>;
  config: MdxxConfig;
  lock?: EmbeddedLock;
  lockFresh: boolean;
}

export function parseDocument(input: string): ParsedDocument {
  const extracted = extractEmbeddedLock(input);
  const frontmatter = parseFrontmatter(extracted.source);
  const sourceDigest = sha256(extracted.source);
  return {
    source: extracted.source,
    body: frontmatter.body,
    sourceDigest,
    metadata: frontmatter.metadata,
    frontmatter: frontmatter.all,
    config: frontmatter.mdxx,
    ...(extracted.lock === undefined ? {} : { lock: extracted.lock }),
    lockFresh: extracted.lock?.sourceDigest === sourceDigest,
  };
}
