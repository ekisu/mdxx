import { formatError } from "./shared/errors.ts";

export async function main(args: string[]): Promise<number> {
  try {
    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
      console.log("Usage: mdxx <init|run|build|lock|unlock|verify|inspect> [options] <document.mdx>");
      return 0;
    }

    throw new Error(`Unknown command: ${args[0]}`);
  } catch (error) {
    console.error(formatError(error));
    return 1;
  }
}
