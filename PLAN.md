# Client-Only Renderer Migration Plan

This plan migrates the current server-rendered and hydrated implementation to the client-only `interactive` profile defined by `DESIGN.md`. The priority is a conventional browser application model that makes ordinary React visualization packages work with minimal mdxx-specific behavior.

## 1. Migration Decisions

- Keep `mdxx.render.mode: interactive` as the default and change its implementation to client-only mounting.
- Generate deterministic build artifacts, but do not claim deterministic browser DOM or visual output.
- Do not execute document or dependency modules during the build.
- Keep Bun 1.3.13 as the supported runtime while the architecture changes.
- Treat React and React DOM as explicit dependencies of each generated document application.
- Prefer standard package resolution over bundler resolver hooks.
- Remove Mermaid support and its package-specific bundle workaround. Diagram support may return later as an independently designed feature.
- Defer SSR, static output, islands, and JavaScript-free document content to separate renderer profiles.

## 2. Remove The SSR Pipeline

Delete the server-rendering path rather than retaining two implementations:

- Remove the generated server entry.
- Remove `react-dom/server` rendering.
- Remove the render worker and deterministic double-render comparison.
- Remove rendering timeouts and output limits that exist only for executing document code.
- Retain subprocess use only where another build operation genuinely executes external code.
- Replace hydration tests with browser mount tests.
- Update diagnostics so build failures and browser runtime failures are not conflated.

The build must not import the compiled document module. Its responsibility ends after compilation, bundling, asset emission, and HTML generation.

## 3. Build A Conventional Dependency Capsule

Generate one isolated application directory for each build:

```text
mdxx-app/
  package.json
  bun.lock
  node_modules/
  entries/
    client.tsx
  source/
    document.mdx
```

- Include the exact renderer-selected `react` and `react-dom` versions in the synthetic `package.json`.
- Include every discovered document package as a normal dependency.
- Normalize versioned author imports such as `pkg@1.2.3/subpath` to standard runtime imports such as `pkg/subpath` before bundling.
- Remove `RUNTIME_PACKAGES` exclusions.
- Remove the bundler plugin that redirects React imports into mdxx's own `node_modules`.
- Resolve all imports from the generated application root.
- Fail early when package peer ranges are incompatible with the selected React runtime.
- Detect multiple bundled React runtimes and report a focused dependency error.
- Record the React runtime and actual peer decisions in the embedded dependency lock.

Add focused fixtures for React Flow, Visx, `react-minimal-pie-chart`, compatible React peers, and incompatible React peers before changing bundlers.

## 4. Generate The Client Entry

Replace the hydration entry with a browser mount entry equivalent to:

```tsx
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import Content from "./document.mdx";

const root = document.getElementById("mdxx-root");
const data = document.getElementById("mdxx-data");
if (!root || !data) throw new Error("Invalid mdxx HTML shell");

const { metadata } = JSON.parse(data.textContent || "{}");
createRoot(root).render(createElement(Content, { metadata }));
```

- Keep metadata serialization canonical and safe for embedding in HTML.
- Use a stable root identifier and stable generated entry source.
- Ensure React Strict Mode is either deliberately enabled or deliberately omitted; do not let development-only behavior vary output.
- Surface uncaught startup errors in a stable document-level diagnostic attribute as well as the browser console.
- Do not add loading UI that introduces timestamps, randomness, or environment-dependent build output.

## 5. Generate The HTML Shell

The generated HTML should contain:

- Stable document metadata and head ordering.
- An initially empty `#mdxx-root` mount point.
- Canonically serialized frontmatter in a non-executable data script.
- Deterministically ordered CSS and client entry references.
- A concise `noscript` message explaining that the visualization requires JavaScript.

Remove all assumptions that the root contains server markup. Determinism tests should compare generated files and names, not the DOM after JavaScript execution.

## 6. Support The Complete Browser Output Graph

Arbitrary visualization packages may emit more than one JavaScript file or depend on browser assets.

- Consume every bundler output rather than selecting the first `.js` file.
- Represent entry chunks, imported chunks, CSS, workers, WASM, fonts, and other assets in an internal build manifest.
- Give emitted files content-addressed names.
- Rewrite references through the manifest rather than global string replacement where possible.
- Preserve deterministic output ordering.
- Allow static dynamic imports whose targets are known to the bundler.
- Continue rejecting computed or unresolved imports.

Inlining a single client bundle may remain an optimization for simple documents, but it must not be a compatibility requirement.

## 7. Remove Mermaid

- Remove the Mermaid dependency.
- Remove Mermaid fence detection and the rehype transform.
- Remove standalone bundle source rewriting and global Mermaid state.
- Remove Mermaid-specific tests, examples, styles, and README claims.
- Render `mermaid` fences as ordinary fenced code until diagram support is redesigned.

This cleanup should happen before evaluating general package compatibility so package-specific workarounds do not influence the new architecture.

## 8. Reassess Bun.build With Real Fixtures

First test `Bun.build` against the conventional capsule. Do not attribute failures to Bun until they reproduce without mdxx resolver hooks.

The compatibility matrix must include:

- React Flow with package CSS and interaction.
- Visx SVG rendering.
- A canvas or WebGL component such as a minimal Three.js React wrapper.
- A package using `ResizeObserver` or layout effects.
- Package-relative images and fonts.
- Static dynamic imports.
- A worker and a WASM asset.
- A package with compatible React peer dependencies.
- A package with incompatible React peer dependencies.

If genuine bundler failures remain, introduce a small bundler interface and compare esbuild with Vite/Rolldown. Keep dependency discovery, locking, assets, HTML generation, and CLI behavior independent of that choice.

## 9. Browser Acceptance Tests

Add Chromium-level tests that serve the generated output and verify behavior after JavaScript runs:

- Plain Markdown appears after client mount.
- Inline and relative TSX components mount.
- State updates after user interaction.
- Third-party visualization components render and respond to input.
- Package CSS loads.
- No uncaught page errors occur.
- Workers, dynamic chunks, and local assets resolve from the output directory.
- Browser-only packages are never imported by a build-time evaluator.

Keep unit tests for parsing, locking, import discovery, and artifact determinism. Browser DOM snapshots should test compatibility, not byte reproducibility.

## 10. Security And Runtime Behavior

- Continue installing dependencies with lifecycle scripts disabled.
- Continue rejecting authored Node built-ins, remote executable imports, CommonJS `require`, and computed imports.
- Document that generated document code has normal browser authority.
- Serve `run` output only on loopback with a fresh temporary output directory.
- Add restrictive default response headers where they do not prevent declared local functionality.
- Do not claim that loopback serving, browser origin isolation, or a cleared CLI environment makes untrusted document code safe.
- Consider an opt-in dedicated browser profile or external sandbox integration separately.

## 11. Documentation And Compatibility

- Update README examples to describe client mounting rather than SSR and hydration.
- Update `init` output only if its frontmatter or starter text makes SSR assumptions.
- Update `inspect` to report the client target, selected React runtime, emitted chunks, and browser assets.
- Update lock target conditions to reflect the actual client build graph.
- Decide whether existing embedded locks are migrated, rejected with a focused diagnostic, or refreshed by `mdxx lock`.
- Treat the renderer change as a format or CLI compatibility decision before release, even though the accepted frontmatter mode name remains `interactive`.

## Delivery Order

1. Remove Mermaid and its package-specific runtime path.
2. Add browser acceptance infrastructure and capture current client behavior.
3. Generate the conventional dependency capsule with explicit React dependencies.
4. Normalize versioned imports and remove custom React/package resolution hooks.
5. Replace the server and hydration entries with one client mount entry.
6. Remove the worker-based SSR pipeline and its tests.
7. Introduce the complete browser output manifest and multi-chunk asset emission.
8. Run the third-party compatibility matrix and decide whether `Bun.build` remains suitable.
9. Update lock targets, inspection output, README, and release compatibility notes.
10. Audit deterministic artifacts, browser behavior, security claims, and the final worktree.

The first milestone is a plain MDX document that builds without executing document code and mounts successfully in Chromium. The decisive milestone is React Flow, Visx, and a browser-only visualization package working through ordinary imports in the same dependency capsule.
