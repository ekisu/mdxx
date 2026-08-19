# mdxx

CLI for rendering reproducible, interactive HTML from self-describing MDX documents. See [`DESIGN.md`](./DESIGN.md) for the approved format and rendering contract.

Enter the development environment and install dependencies:

```bash
devenv shell
bun install
```

Run the CLI, tests, or type checker:

```bash
bun run start
bun test
bun run check
```

## Document

An mdxx document is ordinary MDX with strict YAML frontmatter:

```mdx
---
title: Example
mdxx:
  format: 1
---

# Hello
```

JavaScript and TypeScript components can be declared inline or imported from relative modules. Bare npm imports are resolved in an isolated generated project; local images and CSS are content-addressed in the build output.

## Commands

```text
mdxx init document.mdx
mdxx inspect document.mdx
mdxx verify document.mdx
mdxx lock document.mdx
mdxx unlock document.mdx
mdxx build document.mdx --output dist
mdxx build document.mdx --locked --output dist
mdxx run document.mdx
mdxx run document.mdx --locked
```

`build` creates `<document-name>.html` and, when needed, `assets/`. It refuses to replace an existing output path. `run` performs the same build in a temporary directory and serves it on `127.0.0.1`.

An embedded lock records the exact Bun lock state, normalized package graph, target, integrity values, and source digest. Locked builds use Bun's frozen lockfile mode and reject graph, target, integrity, or source drift.

## Security

Document code runs in a subprocess with a cleared environment, fixed locale/time zone, timeout, CPU limit where supported, bounded output, and process-group termination. Built-in modules, remote code imports, dynamic imports, CommonJS `require`, and absolute imports are rejected before execution.

Subprocess separation is not a filesystem or network sandbox. This version does not enforce read-only filesystem access or block network syscalls on every supported platform, so untrusted documents must still be run inside an OS sandbox or container. See [`DESIGN.md`](./DESIGN.md) for the complete format, reproducibility contract, and security boundaries.
