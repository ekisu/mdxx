import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmbeddedLock } from "../document/embedded-lock.ts";
import type { PackageSpecifier } from "../imports/specifier.ts";
import { MdxxError } from "../shared/errors.ts";
import { parseBunLock, type ResolvedPackage } from "./bun-lock.ts";
import type { DependencyEnvironment } from "./environment.ts";

export interface LockedRoot extends PackageSpecifier {
  version: string;
}

export interface DependencyLock extends EmbeddedLock {
  roots: LockedRoot[];
  packages: ResolvedPackage[];
  resolver: { name: "mdxx"; version: string };
  target: {
    runtime: "bun";
    version: string;
    platform: string;
    architecture: string;
    conditions: string[];
  };
}

const RUNTIME_PACKAGES = new Set(["react", "react-dom"]);

function isDependencyLock(lock: EmbeddedLock): lock is DependencyLock {
  return Array.isArray(lock.roots) && Array.isArray(lock.packages) && lock.target !== null && typeof lock.target === "object";
}

function requestedDependencies(packages: PackageSpecifier[], lock?: DependencyLock): Record<string, string> {
  const result: Record<string, string> = {};
  for (const specifier of packages) {
    if (RUNTIME_PACKAGES.has(specifier.name)) continue;
    const lockedRoot = lock?.roots.find((root) => root.original === specifier.original);
    const request = lockedRoot?.version ?? specifier.selector;
    const previous = result[specifier.name];
    if (previous !== undefined && previous !== request) {
      throw new MdxxError("CONFLICTING_PACKAGE", `conflicting selectors for ${specifier.name}: ${previous} and ${request}`);
    }
    result[specifier.name] = request;
  }
  return result;
}

async function install(directory: string): Promise<ResolvedPackage[]> {
  const child = Bun.spawn([process.execPath, "install", "--ignore-scripts", "--no-progress", "--save-text-lockfile"], {
    cwd: directory,
    env: { HOME: process.env.HOME ?? "", PATH: process.env.PATH ?? "", TMPDIR: tmpdir() },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, child.stdout.text(), child.stderr.text()]);
  if (code !== 0) throw new MdxxError("DEPENDENCY_INSTALL_FAILED", stderr.trim() || stdout.trim());
  return parseBunLock(await Bun.file(join(directory, "bun.lock")).text());
}

function packageKey(item: ResolvedPackage): string {
  return `${item.locator}\0${item.name}\0${item.version}\0${item.integrity}`;
}

function verifyLockedPackages(actual: ResolvedPackage[], expected: ResolvedPackage[]): void {
  const actualKeys = actual.map(packageKey).sort();
  const expectedKeys = expected.map(packageKey).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new MdxxError("LOCK_MISMATCH", "installed dependency graph does not match the embedded lock");
  }
}

function rootVersion(packages: ResolvedPackage[], name: string): string {
  const root = packages.find((item) => item.locator === name);
  if (!root) throw new MdxxError("DEPENDENCY_INSTALL_FAILED", `Bun lock has no root package for ${name}`);
  return root.version;
}

export function currentTarget(): DependencyLock["target"] {
  return {
    runtime: "bun",
    version: Bun.version,
    platform: process.platform,
    architecture: process.arch,
    conditions: ["bun", "import", "default"],
  };
}

export function assertCompatibleTarget(lock: DependencyLock): void {
  const target = currentTarget();
  if (
    lock.target.runtime !== target.runtime ||
    lock.target.version !== target.version ||
    lock.target.platform !== target.platform ||
    lock.target.architecture !== target.architecture ||
    JSON.stringify(lock.target.conditions) !== JSON.stringify(target.conditions)
  ) {
    throw new MdxxError("INCOMPATIBLE_TARGET", "embedded lock target does not match this Bun runtime and platform");
  }
}

export async function prepareDependencies(
  packages: PackageSpecifier[],
  embedded?: EmbeddedLock,
): Promise<{ environment: DependencyEnvironment; lock: Omit<DependencyLock, "sourceDigest"> }> {
  const locked = embedded === undefined ? undefined : isDependencyLock(embedded) ? embedded : undefined;
  if (embedded && !locked) throw new MdxxError("INVALID_LOCK", "embedded lock has no dependency graph");
  if (locked) assertCompatibleTarget(locked);

  const directory = await mkdtemp(join(tmpdir(), "mdxx-deps-"));
  try {
    const dependencies = requestedDependencies(packages, locked);
    await Bun.write(join(directory, "package.json"), JSON.stringify({ name: "mdxx-document", private: true, dependencies }));
    const resolved = Object.keys(dependencies).length === 0 ? [] : await install(directory);
    if (locked) verifyLockedPackages(resolved, locked.packages);

    const roots: LockedRoot[] = packages
      .filter((item) => !RUNTIME_PACKAGES.has(item.name))
      .map((item) => ({ ...item, version: rootVersion(resolved, item.name) }))
      .sort((a, b) => a.original.localeCompare(b.original, "en"));
    const mappings = new Map<string, string>();
    for (const item of packages) {
      if (!RUNTIME_PACKAGES.has(item.name)) mappings.set(item.original, `${item.name}${item.subpath}`);
    }
    return {
      environment: {
        directory,
        mappings,
        dispose: () => rm(directory, { recursive: true, force: true }),
      },
      lock: {
        roots,
        packages: resolved,
        resolver: { name: "mdxx", version: "1.0.0" },
        target: currentTarget(),
      },
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
