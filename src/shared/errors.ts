import { codeFrameColumns } from "@babel/code-frame";

export interface SourcePosition {
  line: number;
  column: number;
}

export interface SourceDiagnostic {
  path: string;
  source: string;
  start: SourcePosition;
  end?: SourcePosition;
  label?: string;
}

export interface MdxxErrorOptions extends ErrorOptions {
  diagnostic?: SourceDiagnostic;
  help?: string;
}

export class MdxxError extends Error {
  readonly code: string;
  readonly diagnostic?: SourceDiagnostic;
  readonly help?: string;

  constructor(code: string, message: string, options: MdxxErrorOptions = {}) {
    super(message, options);
    this.name = "MdxxError";
    this.code = code;
    this.diagnostic = options.diagnostic;
    this.help = options.help;
  }
}

interface LocatedError {
  line?: unknown;
  column?: unknown;
  loc?: { line?: unknown; column?: unknown };
  place?: {
    line?: unknown;
    column?: unknown;
    start?: { line?: unknown; column?: unknown };
    end?: { line?: unknown; column?: unknown };
  };
  reason?: unknown;
}

function rawReason(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const reason = (error as LocatedError).reason;
  if (typeof reason === "string") return reason;
  return error.message.split(/\n\s*\n/, 1)[0]?.replace(/\u001b\[[0-9;]*m/g, "");
}

function textReason(error: unknown): string | undefined {
  return rawReason(error)?.replace(/\s+\(\d+:\d+(?:-\d+:\d+)?\)\s*$/, "");
}

function position(line: unknown, column: unknown, oneBasedColumn: boolean): SourcePosition | undefined {
  if (typeof line !== "number" || typeof column !== "number" || line < 1 || column < 0) return undefined;
  return { line, column: oneBasedColumn ? Math.max(0, column - 1) : column };
}

export function sourceDiagnostic(
  cause: unknown,
  path: string,
  source: string,
  lineOffset = 0,
): SourceDiagnostic | undefined {
  if (!(cause instanceof Error)) return undefined;
  const located = cause as LocatedError;
  let start: SourcePosition | undefined;
  let end: SourcePosition | undefined;

  if (located.loc) start = position(located.loc.line, located.loc.column, false);
  if (!start && located.place) {
    const place = located.place;
    start = place.start
      ? position(place.start.line, place.start.column, true)
      : position(place.line, place.column, true);
    if (place.end) end = position(place.end.line, place.end.column, true);
  }
  if (!start) start = position(located.line, located.column, true);

  if (!start) {
    const match = rawReason(cause)?.match(/\((\d+):(\d+)(?:-(\d+):(\d+))?\)\s*$/);
    if (match) {
      start = position(Number(match[1]), Number(match[2]), true);
      if (match[3] && match[4]) end = position(Number(match[3]), Number(match[4]), true);
    }
  }
  if (!start) return undefined;

  return {
    path,
    source,
    start: { line: start.line + lineOffset, column: start.column },
    ...(end ? { end: { line: end.line + lineOffset, column: end.column } } : {}),
    ...(textReason(cause) ? { label: textReason(cause) } : {}),
  };
}

function causeMessages(error: Error): string[] {
  const messages: string[] = [];
  let cause = error.cause;
  const seen = new Set<unknown>();
  while (cause !== undefined && !seen.has(cause)) {
    seen.add(cause);
    if (cause instanceof MdxxError) messages.push(`${cause.code}: ${cause.message}`);
    else if (cause instanceof Error) messages.push(textReason(cause) ?? cause.message);
    else messages.push(String(cause));
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  return messages;
}

export function formatError(error: unknown): string {
  if (!(error instanceof Error)) return `mdxx: ${String(error)}`;

  const lines = [error instanceof MdxxError ? `mdxx: ${error.code}: ${error.message}` : `mdxx: ${error.message}`];
  if (error instanceof MdxxError && error.diagnostic) {
    const { path, source, start, end, label } = error.diagnostic;
    lines.push(
      `  --> ${path}:${start.line}:${start.column + 1}`,
      codeFrameColumns(source, { start, ...(end ? { end } : {}) }, {
        highlightCode: Boolean(process.stderr.isTTY) && process.env.NO_COLOR === undefined,
        ...(label ? { message: label } : {}),
      }),
    );
  }
  const causes = causeMessages(error);
  if (error instanceof MdxxError && error.diagnostic?.label && causes[0] === error.diagnostic.label) causes.shift();
  for (const cause of causes) lines.push(`  caused by: ${cause}`);
  if (error instanceof MdxxError && error.help) lines.push(`  help: ${error.help}`);
  return lines.join("\n");
}
