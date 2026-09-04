# mdxx

CLI for rendering reproducible, interactive HTML from self-describing MDX documents. See [`DESIGN.md`](./DESIGN.md) for the approved format and rendering contract.

## Installation

mdxx requires [Bun](https://bun.sh/) 1.3.13 or newer. Run it without installing:

```bash
bunx @ekisu/mdxx init document.mdx
bunx @ekisu/mdxx run document.mdx
```

It can also be invoked through npm's package runner when Bun is installed:

```bash
npx @ekisu/mdxx init document.mdx
npx @ekisu/mdxx run document.mdx
```

Install it globally when the shorter `mdxx` command is preferred:

```bash
bun add --global @ekisu/mdxx
mdxx --help
```

## Development

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

GitHub Flavored Markdown is supported, including tables and task lists. Fenced `mermaid` blocks are rendered as diagrams in the browser. The generated HTML is an initially empty shell, and the document mounts as a conventional client-side React application.

## Commands

```text
mdxx init document.mdx
mdxx inspect document.mdx
mdxx verify document.mdx
mdxx lock document.mdx
mdxx unlock document.mdx
mdxx build document.mdx --output dist
mdxx build document.mdx --output dist --replace
mdxx build document.mdx --locked --output dist
mdxx build document.mdx --locked --output dist --replace
mdxx run document.mdx
mdxx run document.mdx --locked
mdxx smoke document.mdx
mdxx smoke document.mdx --locked --browser /path/to/chromium --timeout 10000
mdxx smoke document.mdx --json
mdxx check document.mdx --probe check.js --locked --browser /path/to/chromium --timeout 10000 --json
```

`build` creates `<document-name>.html` plus content-addressed browser chunks and assets. It refuses to replace an existing output path unless `--replace` is passed. Replacement builds and validates the complete next tree before changing the destination, so a build failure leaves the previous output unchanged and new HTML is never published before its referenced assets. `run` performs the same build in a fresh temporary directory and serves it on `127.0.0.1`. `smoke` builds and serves the document, launches Chromium, and fails unless the runtime reaches its mounted state without browser errors or failed requests. `check` performs that normal build exactly once in a temporary directory, waits for the mounted state, and then runs the required caller-supplied `--probe`. The check page posts its result to the loopback server so mdxx can terminate Chrome as soon as the probe settles, with the configured timeout retained as a watchdog. Chromium is selected by `--browser`, then `CHROMIUM_PATH`, then executable Google Chrome or Chromium apps in `/Applications` and `~/Applications` on macOS, then `chromium` on `PATH`; `--json` emits compact `build`, `mount`, and `probe` phases with the selected browser, console entries, errors, and any probe result.

### Check probes

A probe is a JavaScript async function body. It may use `await` and `return`; mdxx supplies `root` (the mounted `#mdxx-root` element), a timeout-bounded `waitFor(test, message)`, and shadow-DOM-aware `shadowRoots(start?)`, `query(selector, start?)`, and `queryAll(selector, start?)` helpers. For example:

```js
const control = query('[aria-label="Select Release"]');
if (!control) throw new Error("missing release control");
control.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const caption = await waitFor(() => query("figcaption")?.textContent?.startsWith("Release") && query("figcaption"), "caption did not update");
return { caption: caption.textContent.trim() };
```

Run it with `mdxx check examples/vanilla-graph/document.mdx --probe examples/vanilla-graph/check.js`. Throwing fails the probe; a return value is included in the result and must consist strictly of JSON primitives, plain objects, and dense arrays. Undefined values, functions, symbols, bigint, non-finite numbers, negative zero, non-plain objects, and cycles fail the probe rather than being omitted or transformed.

The generated `<html>` element exposes `data-mdxx-state="loading|mounting|mounted|error"`. Uncaught errors during loading or mounting are fatal: `data-mdxx-error` and a visible fallback contain the error message, while smoke diagnostics retain the startup phase, stack, and nested causes. After the initial React commit reaches `mounted`, mdxx removes its global startup listeners; later browser diagnostics follow normal browser handling and do not replace the rendered document or change its mdxx state.

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

`--probe` is an explicit trust decision. mdxx assumes both the document and selected local probe are trusted; `check` is a verification harness, not an adversarial sandbox. mdxx reads the probe as source and executes it only in the temporary browser check page, with the same browser authority as the document. The bootstrap captures its callback primitive, removes itself from the page, and is served only for the initial navigation; later requests for the document receive the ordinary built artifact. Probe source is never written to or retained in ordinary `build`, `run`, or `smoke` output.

Loopback serving and browser-origin isolation do not make untrusted document code safe. Use a dedicated browser profile or stronger external sandbox for untrusted documents. See [`DESIGN.md`](./DESIGN.md) for the complete format, reproducibility contract, and security boundaries.
