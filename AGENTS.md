# Agent Guide

## Project

mdxx is a Bun and TypeScript CLI for rendering reproducible, interactive HTML from self-describing MDX documents. `DESIGN.md` is the source of truth for format and behavior decisions.

## Environment

- Enter the development environment with `devenv shell`.
- Install dependencies with `bun install`.
- Run the scaffold with `bun run start`.
- Type-check with `bun run check`.

## Conventions

- Use strict TypeScript and Bun APIs where they are a good fit.
- Keep changes minimal and aligned with `DESIGN.md`.
- Add tests with Bun's test runner when behavior is introduced.
- Keep generated output, caches, and dependencies out of Git.
- Update documentation when a format or CLI contract changes.
