export class MdxxError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MdxxError";
    this.code = code;
  }
}

export function formatError(error: unknown): string {
  if (error instanceof MdxxError) {
    return `mdxx: ${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return `mdxx: ${error.message}`;
  }
  return `mdxx: ${String(error)}`;
}
