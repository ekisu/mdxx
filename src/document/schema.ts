import { MdxxError } from "../shared/errors.ts";
import { satisfies, validRange } from "semver";
import { MDXX_VERSION } from "../version.ts";

export interface MdxxConfig {
  format: 1;
  requires?: string;
  render: {
    mode: "interactive";
  };
}

export interface FrontmatterData {
  mdxx: MdxxConfig;
  metadata: Record<string, unknown>;
  all: Record<string, unknown>;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new MdxxError("INVALID_FRONTMATTER", `${path} must be a map`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: string[], path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new MdxxError("INVALID_FRONTMATTER", `unknown ${path} field: ${unknown[0]}`);
  }
}

export function validateFrontmatter(value: unknown): FrontmatterData {
  const all = object(value, "frontmatter");
  const mdxx = object(all.mdxx, "mdxx");
  rejectUnknown(mdxx, ["format", "requires", "render"], "mdxx");

  if (mdxx.format !== 1) {
    throw new MdxxError("UNSUPPORTED_FORMAT", "mdxx.format must be 1");
  }
  if (mdxx.requires !== undefined && typeof mdxx.requires !== "string") {
    throw new MdxxError("INVALID_FRONTMATTER", "mdxx.requires must be a string");
  }
  if (typeof mdxx.requires === "string") {
    if (!validRange(mdxx.requires)) throw new MdxxError("INVALID_FRONTMATTER", "mdxx.requires must be a valid semver range");
    if (!satisfies(MDXX_VERSION, mdxx.requires)) {
      throw new MdxxError("INCOMPATIBLE_VERSION", `document requires mdxx ${mdxx.requires}, current version is ${MDXX_VERSION}`);
    }
  }

  const render = mdxx.render === undefined ? {} : object(mdxx.render, "mdxx.render");
  rejectUnknown(render, ["mode"], "mdxx.render");
  if (render.mode !== undefined && render.mode !== "interactive") {
    throw new MdxxError("UNSUPPORTED_RENDER_MODE", "mdxx.render.mode must be interactive");
  }

  const metadata = Object.fromEntries(Object.entries(all).filter(([key]) => key !== "mdxx"));
  return {
    all,
    metadata,
    mdxx: {
      format: 1,
      ...(mdxx.requires === undefined ? {} : { requires: mdxx.requires }),
      render: { mode: "interactive" },
    },
  };
}
