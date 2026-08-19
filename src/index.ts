#!/usr/bin/env bun

import { main } from "./cli.ts";

export { main } from "./cli.ts";

if (import.meta.main) {
  process.exitCode = await main(Bun.argv.slice(2));
}
