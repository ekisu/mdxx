import { canonicalJson } from "../shared/canonical-json.ts";
import { MdxxError } from "../shared/errors.ts";

const LOCK_MARKER = "@mdxx-lock v1";
const LOCK_PATTERN = /\{\/\* @mdxx-lock v1\r?\n([\s\S]*?)\r?\n\*\/\}\s*$/;

export interface EmbeddedLock {
  sourceDigest: string;
  [key: string]: unknown;
}

export interface ExtractedLock {
  source: string;
  lock?: EmbeddedLock;
  raw?: string;
}

export function extractEmbeddedLock(input: string): ExtractedLock {
  const matches = input.match(LOCK_PATTERN);
  const markerCount = input.split(LOCK_MARKER).length - 1;
  if (!matches) {
    if (markerCount > 0) {
      throw new MdxxError("INVALID_LOCK", "lock marker must appear in one valid trailing lock block");
    }
    return { source: input };
  }
  if (markerCount !== 1) {
    throw new MdxxError("INVALID_LOCK", "document contains multiple lock markers");
  }

  let value: unknown;
  try {
    value = JSON.parse(matches[1] ?? "");
  } catch (cause) {
    throw new MdxxError("INVALID_LOCK", "embedded lock is not valid JSON", { cause });
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new MdxxError("INVALID_LOCK", "embedded lock must be a JSON object");
  }
  const lock = value as EmbeddedLock;
  if (typeof lock.sourceDigest !== "string" || !/^sha256-[0-9a-f]{64}$/.test(lock.sourceDigest)) {
    throw new MdxxError("INVALID_LOCK", "embedded lock has an invalid sourceDigest");
  }

  const raw = matches[0];
  return { source: input.slice(0, -raw.length), lock, raw };
}

export function serializeEmbeddedLock(lock: EmbeddedLock): string {
  const json = canonicalJson(lock, 2);
  if (json.includes("*/")) {
    throw new MdxxError("INVALID_LOCK", "serialized lock can terminate its comment");
  }
  return `{/* @mdxx-lock v1\n${json}\n*/}`;
}

export function appendEmbeddedLock(source: string, lock: EmbeddedLock): string {
  return `${source}${serializeEmbeddedLock(lock)}\n`;
}
