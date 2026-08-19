# mdxx Implementation Plan

This plan implements the first version described by `DESIGN.md`. Open questions use pragmatic initial defaults and may be revisited after the interactive format and renderer are stable.

## 1. Version-One Defaults

- `run` builds into a temporary directory and starts a loopback-only local HTTP server.
- Documents without a layout use a minimal built-in HTML shell.
- CSS is supported through ordinary local or package CSS imports.
- The lock target reflects the actual Bun runtime, platform, architecture, and export conditions.
- Built-ins, dynamic imports, and computed imports are rejected in document code.
- Rendering uses a subprocess with a cleared environment and timeout.
- Subprocess separation is the initial portability baseline. Strong filesystem and network isolation remains platform-dependent and must not be claimed where it is not enforced.
- Custom layouts, static rendering, remote module imports, online remote-asset verification, and a component permission system remain deferred.

## 2. Establish Project Structure

Split the scaffold into focused modules:

```text
src/
  index.ts
  cli.ts
  commands/
    init.ts
    run.ts
    build.ts
    lock.ts
    unlock.ts
    verify.ts
    inspect.ts
  document/
    parse.ts
    frontmatter.ts
    embedded-lock.ts
    schema.ts
  imports/
    discover.ts
    specifier.ts
    graph.ts
  dependencies/
    resolve.ts
    bun-lock.ts
    environment.ts
  render/
    compile.ts
    bundle.ts
    server-entry.ts
    client-entry.ts
    html.ts
    worker.ts
  assets/
    discover.ts
    emit.ts
  shared/
    digest.ts
    canonical-json.ts
    errors.ts
    paths.ts
test/
  fixtures/
```

Use Bun's test runner and add `test`, `check`, and executable CLI scripts to `package.json`.

## 3. Document Parsing

Implement the format independently of rendering:

- Locate and parse YAML frontmatter.
- Use the YAML core schema only.
- Reject duplicate keys, custom tags, anchors, and aliases.
- Validate `mdxx.format`, `mdxx.requires`, and `mdxx.render.mode`.
- Preserve non-`mdxx` metadata for components.
- Detect a single trailing `@mdxx-lock v1` block.
- Strip the lock before MDX compilation.
- Calculate `sourceDigest` from the exact source without the lock.
- Serialize lock data as canonical JSON with escaped solidus characters.

Tests should cover malformed frontmatter, unsupported versions, duplicate keys, stale locks, malicious comment terminators, and source digest stability.

## 4. CLI Foundation

Implement argument parsing, consistent diagnostics, and exit codes.

Initial commands:

1. `init`: Create a minimal valid document without overwriting an existing file.
2. `unlock`: Remove only a valid generated trailing lock.
3. `inspect`: Initially report frontmatter, imports, lock state, and source digest.
4. `verify`: Initially validate format, lock freshness, and local file existence.

Implement `build`, `run`, and `lock` as later slices on the same APIs.

## 5. Import Discovery

Build a deterministic module-graph scanner:

- Compile MDX sufficiently to inspect its ESM.
- Parse static imports and exports in MDX, TS, TSX, JS, and JSX.
- Follow relative modules recursively.
- Classify bare packages, relative modules, local assets, remote URLs, and forbidden specifiers.
- Parse unscoped and scoped package selectors, including subpaths.
- Reject Node built-ins, URL code imports, dynamic imports, and computed specifiers.
- Sort graph outputs before reporting or processing.

Test selector cases such as:

```text
react
pkg@1.2.3
pkg@^2/subpath
@scope/pkg
@scope/pkg@next/subpath
```

## 6. Dependency Environments

Resolve packages in an isolated generated project:

- Generate a temporary `package.json` from root package declarations.
- Use `bun install` with Bun's shared global cache.
- Keep installed dependencies outside the authored document directory.
- Record requested root specifiers separately from resolved versions.
- Parse Bun's lockfile into an internal dependency graph.
- Never modify the author's source during unlocked resolution.
- In locked mode, materialize exactly the embedded graph and reject undeclared resolution.
- Verify package integrity before rendering.

Encapsulate Bun-specific lockfile handling behind an internal interface so a Bun lock format change does not affect the mdxx document format.

## 7. Minimal Interactive Renderer

First make a dependency-free interactive document work end to end:

- Compile TypeScript-enabled MDX with `@mdx-js/mdx`.
- Generate a server entry and browser hydration entry.
- Bundle both with Bun.
- Execute the server bundle in a subprocess.
- Render initial markup with `react-dom/server`.
- Hydrate with `hydrateRoot`.
- Inline the browser bundle into the generated HTML.
- Emit a deterministic built-in HTML shell.
- Pass frontmatter metadata through the rendering context.
- Set explicit locale and time zone.
- Exclude timestamps, temporary paths, and machine-specific data.

Then extend the same pipeline to relative components and installed packages.

## 8. Assets and CSS

Add deterministic asset handling:

- Discover imported assets and static local URLs in Markdown and JSX.
- Resolve paths relative to the declaring source file.
- Hash file bytes with SHA-256.
- Emit stable names such as `name.<digest-prefix>.ext`.
- Deduplicate identical assets.
- Rewrite references in HTML, JavaScript, and CSS.
- Preserve HTTP and HTTPS URLs unchanged.
- Report remote URLs through `inspect`.
- Process local and package CSS imports, inlining generated CSS when practical.
- Sort emitted assets and styles deterministically.

Fail on missing local assets and avoid copying files outside the declared source graph.

## 9. Embedded Lock Commands

Implement the complete lock workflow:

- `lock` discovers imports and resolves the entire package graph.
- Record root requests, exact versions, resolutions, integrity, dependencies, peers, optional decisions, target, resolver, and source digest.
- Replace an existing valid lock atomically.
- `build` and `run` use a current lock automatically.
- A stale lock fails unless running `lock`.
- `--locked` requires a current lock and forbids undeclared resolution.
- `verify` checks source freshness, package integrity, target compatibility, and local assets.

Use temporary files plus atomic rename when changing a document.

## 10. Build and Run Commands

### `build`

- Validate and resolve the document.
- Render into a temporary output directory.
- Commit the completed output atomically.
- Produce `<document-name>.html` and `assets/`.
- Reject conflicting output paths.
- Ensure a failed build leaves no partial output.

### `run`

- Use the same build pipeline.
- Write to a temporary directory.
- Serve through a loopback-only Bun HTTP server.
- Print the URL and clean up on termination.
- Do not introduce a separate development rendering path in version one.

## 11. Isolation and Limits

Run document code only in a worker subprocess:

- Pass an allowlisted environment rather than inheriting `process.env`.
- Set deterministic locale and timezone.
- Enforce a rendering timeout.
- Capture structured output over stdin and stdout.
- Limit output size.
- Terminate the process tree on timeout or cancellation.
- Allow network access only during dependency resolution.
- Reject unsupported imports before execution.

True read-only filesystem and network enforcement will require OS sandbox or container integration. Track this explicitly rather than claiming subprocess isolation provides it.

## 12. Determinism and Acceptance Tests

Add fixture-based end-to-end tests covering:

- Plain Markdown.
- Inline TSX components.
- Relative TSX components.
- Interactive state after hydration.
- Exact, ranged, tagged, scoped, and subpath package imports.
- Locked and unlocked builds.
- Stale and tampered locks.
- Local images, fonts, CSS, and duplicate assets.
- Preserved remote assets.
- Forbidden built-ins and dynamic imports.
- Rendering timeout and runtime failure.
- Paths containing spaces and non-ASCII characters.

For deterministic fixtures, build twice in separate temporary directories and compare every output byte and filename.

## Recommended Delivery Order

1. Parser, lock extraction, canonical JSON, and tests.
2. `init`, `unlock`, basic `inspect`, and basic `verify`.
3. Dependency-free SSR and hydration.
4. Relative module graph and package resolution.
5. Deterministic assets and CSS.
6. Complete lock generation and locked installation.
7. `build` and `run`.
8. Isolation, determinism auditing, documentation, and release packaging.

The first meaningful milestone is a dependency-free `.mdx` file producing server-rendered, hydratable HTML. Package locking and asset processing can then be added without replacing the rendering architecture.
