import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmbeddedLock } from "../document/embedded-lock.ts";
import type { PackageSpecifier } from "../imports/specifier.ts";
import { MdxxError } from "../shared/errors.ts";
import { canonicalJson } from "../shared/canonical-json.ts";
import { parseBunLock, type ResolvedPackage } from "./bun-lock.ts";
import type { DependencyEnvironment } from "./environment.ts";

export interface LockedRoot extends PackageSpecifier {
  version: string;
}

export interface DependencyLock extends EmbeddedLock {
  roots: LockedRoot[];
  packages: ResolvedPackage[];
  resolver: {
    name: "mdxx";
    version: string;
    state?: { format: "bun-lock-v1"; contents: string };
  };
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
  if (!Array.isArray(lock.roots) || !Array.isArray(lock.packages) || lock.target === null || typeof lock.target !== "object") return false;
  if (lock.resolver === null || typeof lock.resolver !== "object") return false;
  const resolver = lock.resolver as Record<string, unknown>;
  if (resolver.name !== "mdxx" || resolver.version !== "1.0.0") return false;
  return lock.roots.every((root) => root !== null && typeof root === "object") &&
    lock.packages.every((item) => item !== null && typeof item === "object");
}

function requestedDependencies(packages: PackageSpecifier[], lock?: DependencyLock): Record<string, string> {
  const result: Record<string, string> = {};
  for (const specifier of packages) {
    if (RUNTIME_PACKAGES.has(specifier.name)) continue;
    const lockedRoot = lock?.roots.find((root) => root.original === specifier.original);
    const request = lockedRoot?.selector ?? specifier.selector;
    const previous = result[specifier.name];
    if (previous !== undefined && previous !== request) {
      throw new MdxxError("CONFLICTING_PACKAGE", `conflicting selectors for ${specifier.name}: ${previous} and ${request}`);
    }
    result[specifier.name] = request;
  }
  return result;
}

async function install(directory: string, frozen = false): Promise<{ packages: ResolvedPackage[]; lockSource: string }> {
  const command = [process.execPath, "install", "--ignore-scripts", "--no-progress", "--save-text-lockfile"];
  if (frozen) command.push("--frozen-lockfile");
  const child = Bun.spawn(command, {
    cwd: directory,
    env: { HOME: process.env.HOME ?? "", PATH: process.env.PATH ?? "", TMPDIR: tmpdir() },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, child.stdout.text(), child.stderr.text()]);
  if (code !== 0) throw new MdxxError("DEPENDENCY_INSTALL_FAILED", stderr.trim() || stdout.trim());
  const lockSource = await Bun.file(join(directory, "bun.lock")).text();
  return { packages: parseBunLock(lockSource), lockSource };
}

function verifyLockedPackages(actual: ResolvedPackage[], expected: ResolvedPackage[]): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new MdxxError("LOCK_MISMATCH", "installed dependency graph does not match the embedded lock");
  }
}

function verifyLockedRoots(specifiers: PackageSpecifier[], roots: LockedRoot[]): void {
  const expected = specifiers.filter((item) => !RUNTIME_PACKAGES.has(item.name));
  if (expected.length !== roots.length) throw new MdxxError("LOCK_MISMATCH", "embedded lock roots do not match package imports");
  for (const specifier of expected) {
    const root = roots.find((item) => item.original === specifier.original);
    if (
      !root || root.name !== specifier.name || root.selector !== specifier.selector || root.subpath !== specifier.subpath ||
      typeof root.version !== "string"
    ) {
      throw new MdxxError("LOCK_MISMATCH", `embedded lock root does not match ${specifier.original}`);
    }
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
    conditions: ["browser", "bun", "default", "import", "node"],
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
  if (locked) {
    assertCompatibleTarget(locked);
    verifyLockedRoots(packages, locked.roots);
  }

  const directory = await mkdtemp(join(tmpdir(), "mdxx-deps-"));
  try {
    const dependencies = requestedDependencies(packages, locked);
    await Bun.write(join(directory, "package.json"), JSON.stringify({ name: "mdxx-document", private: true, dependencies }));
    if (locked && Object.keys(dependencies).length > 0) {
      const state = locked.resolver.state;
      if (state?.format !== "bun-lock-v1" || typeof state.contents !== "string") {
        throw new MdxxError("INVALID_LOCK", "embedded lock has no Bun resolver state");
      }
      await Bun.write(join(directory, "bun.lock"), state.contents);
    }
    const installation = Object.keys(dependencies).length === 0
      ? { packages: [], lockSource: "" }
      : await install(directory, locked !== undefined);
    const resolved = installation.packages;
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
        resolver: {
          name: "mdxx",
          version: "1.0.0",
          ...(installation.lockSource ? { state: { format: "bun-lock-v1" as const, contents: installation.lockSource } } : {}),
        },
        target: currentTarget(),
      },
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
