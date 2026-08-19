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

JavaScript and TypeScript components can be declared inline or imported from relative modules. Bare npm imports are resolved in an isolated generated application with explicit React dependencies; local images and CSS are content-addressed in the build output.

GitHub Flavored Markdown is supported, including tables and task lists. The generated HTML is an initially empty shell; the document mounts as a conventional client-side React application. Fenced `mermaid` content is ordinary code until diagram support is designed independently.

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

`build` creates `<document-name>.html` plus content-addressed browser chunks and assets. It refuses to replace an existing output path. `run` performs the same build in a fresh temporary directory and serves it on `127.0.0.1`.

## Examples

Each example is an isolated document project:

- `examples/vanilla-graph/document.mdx` is a self-contained Markdown-first document with one inline `<style>` block and one interactive SVG, with no external stylesheet.
- `examples/northstar-microgrid/document.mdx` is a complete interactive commissioning dossier with React Flow, custom Visx SVG charts, ECharts Canvas rendering, package fonts, a lazy browser chunk, and a deterministic Worker simulation.
- `examples/project-plan/document.mdx` is the earlier multi-file implementation plan.

```bash
bun run start run examples/vanilla-graph/document.mdx
bun run start run examples/northstar-microgrid/document.mdx
```

An embedded lock records the exact Bun lock state, normalized package graph, target, integrity values, and source digest. Locked builds use Bun's frozen lockfile mode and reject graph, target, integrity, or source drift.

## Security

Document code is bundled without being imported or evaluated by the build and runs with normal browser authority after client mounting. Built-in modules, remote code imports, computed imports, CommonJS `require`, and absolute imports are rejected; static dynamic imports are included in the browser output graph.

Loopback serving and browser-origin isolation do not make untrusted document code safe. Use a dedicated browser profile or stronger external sandbox for untrusted documents. See [`DESIGN.md`](./DESIGN.md) for the complete format, reproducibility contract, and security boundaries.
