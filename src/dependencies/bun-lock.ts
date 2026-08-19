import { MdxxError } from "../shared/errors.ts";

interface BunPackageMetadata {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalPeers?: string[];
}

type BunPackageTuple = [string, string, BunPackageMetadata, string];

interface BunLockfile {
  lockfileVersion?: unknown;
  packages?: unknown;
}

export interface ResolvedPackage {
  locator: string;
  name: string;
  version: string;
  resolution: string;
  integrity: string;
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  optionalPeers: string[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringRecord(value: unknown): Record<string, string> {
  const input = record(value);
  if (!input || Object.values(input).some((item) => typeof item !== "string")) return {};
  return input as Record<string, string>;
}

function packageIdentity(resolution: string): { name: string; version: string } {
  const separator = resolution.lastIndexOf("@");
  if (separator <= 0 || separator === resolution.length - 1) {
    throw new MdxxError("UNSUPPORTED_BUN_LOCK", `unsupported package resolution: ${resolution}`);
  }
  return { name: resolution.slice(0, separator), version: resolution.slice(separator + 1) };
}

export function parseBunLock(source: string): ResolvedPackage[] {
  const lock = Bun.JSONC.parse(source) as BunLockfile;
  if (lock.lockfileVersion !== 1) throw new MdxxError("UNSUPPORTED_BUN_LOCK", "expected Bun lockfile version 1");
  const packages = record(lock.packages);
  if (!packages) throw new MdxxError("UNSUPPORTED_BUN_LOCK", "Bun lockfile has no packages map");

  const result: ResolvedPackage[] = [];
  for (const [locator, raw] of Object.entries(packages)) {
    if (!Array.isArray(raw) || raw.length !== 4 || typeof raw[0] !== "string" || typeof raw[1] !== "string" || typeof raw[3] !== "string") {
      throw new MdxxError("UNSUPPORTED_BUN_LOCK", `unsupported Bun package entry: ${locator}`);
    }
    const tuple = raw as BunPackageTuple;
    const identity = packageIdentity(tuple[0]);
    const metadata = record(tuple[2]) as BunPackageMetadata | undefined;
    result.push({
      locator,
      ...identity,
      resolution: tuple[1] || `npm:${identity.name}@${identity.version}`,
      integrity: tuple[3],
      dependencies: stringRecord(metadata?.dependencies),
      optionalDependencies: stringRecord(metadata?.optionalDependencies),
      peerDependencies: stringRecord(metadata?.peerDependencies),
      optionalPeers: Array.isArray(metadata?.optionalPeers)
        ? metadata.optionalPeers.filter((value): value is string => typeof value === "string").sort()
        : [],
    });
  }
  return result.sort((a, b) => a.locator.localeCompare(b.locator, "en"));
}
