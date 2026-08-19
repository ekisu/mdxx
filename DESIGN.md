# mdxx Design

## Status

This document describes the initial file format and rendering contract for a CLI that builds self-describing, reproducible MDX documents.

## Goals

- Keep documents recognizable as ordinary MDX.
- Make arbitrary React components easy to import and use.
- Treat ordinary package imports as dependency declarations.
- Allow, but do not require, a complete dependency lock.
- Produce deterministic HTML when all declared inputs are unchanged.
- Keep local and remote assets outside the dependency capsule.
- Avoid requiring custom package import syntax.

## Non-goals

- Guarantee that mutable remote assets render identically over time.
- Make unlocked transitive dependency resolution reproducible.
- Embed local assets or dependency package contents in every MDX file.
- Safely execute untrusted components in the CLI process.

## Document Format

An mdxx document consists of three parts:

1. Human-authored YAML frontmatter.
2. Ordinary MDX imports and content.
3. An optional generated dependency lock at the end of the file.

```mdx
---
title: Quarterly report

mdxx:
  format: 1
  requires: ">=1 <2"
  render:
    mode: interactive
---

import {Callout} from '@acme/ui'
import {BarChart} from '@acme/charts'

# Quarterly report

<Callout tone="warning">
  Preliminary figures.
</Callout>

<BarChart data={[{month: 'Jan', value: 18}]} />

{/* @mdxx-lock v1
{
  "sourceDigest": "sha256-...",
  "packages": []
}
*/}
```

### Frontmatter

YAML frontmatter fits established Markdown and MDX authoring conventions. mdxx owns only the `mdxx` key; all other keys remain document metadata available to other tools and to components.

The initial schema is:

```yaml
mdxx:
  format: 1
  requires: ">=1 <2"
  render:
    mode: interactive
```

- `format` identifies the mdxx document format.
- `requires` constrains compatible mdxx CLI versions.
- `render.mode` selects a renderer profile. It defaults to `interactive` when omitted.

The parser must reject duplicate keys and custom YAML tags. It should accept only maps, arrays, strings, numbers, booleans, and null; anchors and aliases should also be rejected unless a concrete need emerges.

### Imports

Package usage requires no custom syntax:

```mdx
import {Callout} from '@acme/ui'
```

Bare package imports are dependency declarations and are installed automatically, following Bun's auto-install model. This applies to imports discovered in the MDX document and its local module graph. An unversioned import resolves the package's `latest` tag when no current embedded lock supplies a version.

Authors may use Bun-style version specifiers directly in an import when they want to constrain resolution without separate dependency metadata:

```mdx
import {Callout} from '@acme/ui@2.4.1'
import {BarChart} from '@acme/charts@^4.3.0'
import {Preview} from '@acme/preview@next'
```

Exact versions select one release. Semver ranges select a compatible release, and npm tags select the release currently referenced by that tag. The embedded lock records the exact selected version in all three cases. Scoped package selectors are parsed after the package name, as shown above, and a package subpath follows the selector.

Relative imports refer to local modules and are treated as local build inputs.

In unlocked mode, an unresolved bare import is resolved from the configured package registry and cached without modifying the authored source. The optional embedded lock records the selected version and complete transitive graph. Node built-ins are not packages and remain subject to the security policy.

### Inline Components

Authors may define typed components directly with TypeScript-enabled MDX ESM exports:

```mdx
export interface MetricProps {
  label: string
  value: string
}

export function Metric({label, value}: MetricProps) {
  return (
    <section className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </section>
  )
}

<Metric label="Downloads" value="12,400" />
```

## Dependency Resolution

Unlocked execution follows Bun's auto-install model:

1. Discover bare package imports in the MDX and local module graph.
2. Resolve missing packages in an isolated package environment.
3. Store downloaded packages in a shared content cache.
4. Compile and render the MDX using that environment.

The cache is an optimization, not part of the document's reproducibility contract.

An unlocked import does not select a stable package version. Its direct or transitive resolution can change over time. Platform-specific packages, package export conditions, registry changes, and resolver changes can also affect resolution. Strict reproducibility therefore requires a lock.

## Embedded Lock

Locking is optional. `mdxx lock document.mdx` appends or replaces a generated JSON block at the end of the document:

```mdx
{/* @mdxx-lock v1
{
  "sourceDigest": "sha256-...",
  "resolver": {
    "name": "mdxx",
    "version": "1.0.0"
  },
  "target": {
    "runtime": "node",
    "version": "24",
    "platform": "linux",
    "architecture": "x64",
    "conditions": ["node", "import"]
  },
  "packages": [
    {
      "name": "@acme/ui",
      "version": "2.4.1",
      "resolution": "https:\/\/registry.npmjs.org\/@acme\/ui\/-\/ui-2.4.1.tgz",
      "integrity": "sha512-...",
      "dependencies": {
        "clsx": "2.1.1"
      }
    }
  ]
}
*/}
```

The lock records:

- Root package import specifiers, including any requested version, range, or tag.
- The complete resolved package graph.
- Exact versions and package integrity hashes.
- Peer and optional dependency decisions.
- Runtime target and module resolution conditions.
- Resolver information needed to diagnose incompatibilities.
- A digest of the author-owned source.

`sourceDigest` is calculated after removing the lock block. This avoids a circular digest and detects stale locks after any authored content or frontmatter change.

The lock uses canonical JSON. Solidus characters are escaped as `\/` so generated values cannot contain `*/` and terminate the MDX block comment. The CLI strips the lock before passing the document to the MDX compiler.

Removing the lock restores normal unlocked behavior without changing the authored document.

### Lock Behavior

- `mdxx run` and `mdxx build` use a current embedded lock when present.
- Without a lock, they discover and resolve bare package imports.
- A stale lock produces an error by default rather than being silently replaced.
- `mdxx lock` creates or refreshes the lock.
- `mdxx unlock` removes only the generated lock block.
- `mdxx run --locked` and `mdxx build --locked` require a current lock and forbid resolution outside it.
- Package bytes must match the recorded integrity before use.

## Assets

Assets are external build inputs and are not embedded in the lock or a package capsule.

### Local Assets

Relative images, fonts, media, and component-imported assets are copied alongside the generated HTML. Output names are derived from content hashes:

```text
dist/
  report.html
  assets/
    diagram.a41fe920.png
    report.19cbd871.woff2
```

Asset digests are computed during each build to derive output names and do not need to be stored in the dependency lock. Asset ordering and generated names must be deterministic.

### Remote Assets

Remote image, font, and media URLs are preserved without fetching them:

```mdx
![Diagram](https://cdn.example.com/diagram.png)
```

This keeps HTML generation deterministic because the URL is unchanged, but it does not guarantee visual reproducibility if the remote content changes. Builds should report mutable remote assets without rejecting them. A future online verification command may optionally record or check remote content digests.

Remote executable code is not treated as an asset. Components must be resolved through package imports or local modules so their code participates in dependency resolution and integrity checking.

## Reproducibility Contract

For a fixed rendering target:

```text
same mdxx version
+ same MDX source excluding the generated lock
+ same resolved dependency graph
+ same local asset bytes
= same generated HTML and copied asset names
```

An embedded lock makes the resolved dependency graph portable. Without one, package imports may resolve differently over time.

Remote asset content is deliberately outside this contract. Its URL affects generated HTML; the bytes served by that URL affect only the later visual rendering.

Deterministic generation also requires:

- Stable module, style, and asset ordering.
- Canonical serialization of generated metadata.
- No timestamps or machine-specific absolute paths in output.
- Content-derived asset names.
- Explicit rendering locale and time zone.
- No undeclared environment-variable inputs.
- No build-time network access except dependency resolution in unlocked mode.

## Rendering

The initial renderer compiles JavaScript or TypeScript MDX, server-renders the initial React markup, and bundles the client runtime needed to hydrate it. TypeScript is transpiled without type-checking during rendering; a separate validation command may report type errors. The mdxx major version defines the MDX compiler, TypeScript transform, React runtime, HTML serializer, bundler, and module resolution behavior so those implementation packages do not need to be repeated in each document.

The initial and default `interactive` profile:

- Produces server-rendered HTML with bundled client-side JavaScript for hydration.
- Bundles component code and the runtime into the generated HTML.
- Inlines generated component CSS when practical.
- Rewrites local asset references to copied, content-addressed files.
- Preserves remote asset URLs.
- Requires components to tolerate server rendering for the initial markup; browser-only behavior may start after hydration.

A `static` profile that omits client-side JavaScript may be added later for documents that do not need interaction.

## Open Questions

### Templates and Styling

The initial design has not selected a document template or styling API. Viable options include:

- Use ordinary local or package CSS imports for styling and process them through the existing module and asset pipeline.
- Select an automatic document template in frontmatter, identified by a package export and resolved and locked like any other package import.
- Require authors to use explicit layout components in the MDX body, avoiding a separate template mechanism at the cost of manual wrapping.
- Define a conventional MDX export that supplies the document layout while keeping the dependency visible as an ordinary import.

A conventional export could look like this:

```mdx
import {ReportLayout} from '@acme/report-theme@2.1.0'

export const layout = ReportLayout

# Quarterly report

Report content.
```

After compiling the MDX module, the renderer would read both its generated default content component and the conventional named export, then conceptually render:

```tsx
const {default: Content, layout: Layout} = compiledModule

<Layout metadata={frontmatter}>
  <Content />
</Layout>
```

The ordinary import keeps template discovery, auto-installation, version selection, and locking in the existing dependency pipeline. The named export connects that imported component to the renderer without trying to reference a JavaScript binding from YAML. MDX's generated default export remains reserved for the document content.

This option would still need to define the conventional export name, layout props, head contribution mechanism, and behavior when no layout is exported. The example illustrates the mechanism rather than deciding those details.

A likely separation is to use CSS imports for styling and an optional template only for document-shell concerns such as `<html>`, head metadata, navigation, and content framing. Before choosing an API, the renderer design must establish how a template receives frontmatter, rendered content, head contributions, and hydration state without creating a second component model.

## Security

MDX and arbitrary components execute JavaScript. Rendering must not evaluate untrusted content in the main CLI process.

The renderer should run in an isolated worker or subprocess with:

- No inherited secrets or undeclared environment variables.
- No network access after dependency resolution by default.
- Read-only access to declared source and asset inputs.
- No access to unrelated filesystem paths.
- CPU, memory, and execution time limits.

Node built-ins, dynamic imports, and computed module specifiers should be rejected initially unless an explicit permission model is introduced.

## Initial CLI

```text
mdxx init document.mdx
mdxx run document.mdx
mdxx build document.mdx --output dist/
mdxx lock document.mdx
mdxx unlock document.mdx
mdxx verify document.mdx
mdxx inspect document.mdx
```

- `init` creates a minimal MDX document with mdxx frontmatter.
- `run` auto-installs unresolved package imports if necessary and renders for immediate use.
- `build` writes deterministic HTML and local assets.
- `lock` embeds the complete resolved dependency graph.
- `unlock` removes the embedded lock.
- `verify` checks source and package integrity and confirms that referenced local assets are available.
- `inspect` reports imports, resolved versions, assets, target conditions, and remote URLs.

## Initial Scope

The first version should support:

- JavaScript and TypeScript MDX with React components.
- YAML frontmatter with namespaced mdxx configuration.
- Standard bare and relative imports.
- npm package resolution with a shared cache.
- Optional embedded dependency locks.
- Interactive HTML rendering with server-rendered initial markup and hydration.
- External local assets with deterministic copied names.
- Directly linked remote assets.

A static rendering profile, remote module imports, online remote-asset verification, and a component permission system are deferred until the interactive format and renderer are stable.
