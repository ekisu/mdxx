import { formatError } from "./shared/errors.ts";
import { init } from "./commands/init.ts";
import { inspect } from "./commands/inspect.ts";
import { unlock } from "./commands/unlock.ts";
import { verify } from "./commands/verify.ts";
import { canonicalJson } from "./shared/canonical-json.ts";
import { MdxxError } from "./shared/errors.ts";

const USAGE = "Usage: mdxx <init|run|build|lock|unlock|verify|inspect> [options] <document.mdx>";

function documentArgument(args: string[]): string {
  const paths = args.filter((argument) => !argument.startsWith("-"));
  if (paths.length !== 1) throw new MdxxError("USAGE", USAGE);
  return paths[0] as string;
}

export async function main(args: string[]): Promise<number> {
  try {
    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
      console.log(USAGE);
      return 0;
    }

    const [command, ...rest] = args;
    const path = documentArgument(rest);
    switch (command) {
      case "init":
        await init(path);
        console.log(`Created ${path}`);
        break;
      case "unlock":
        await unlock(path);
        console.log(`Unlocked ${path}`);
        break;
      case "inspect":
        console.log(canonicalJson(await inspect(path), 2));
        break;
      case "verify":
        await verify(path);
        console.log(`${path}: valid`);
        break;
      default:
        throw new MdxxError("USAGE", `unknown command: ${command}\n${USAGE}`);
    }
    return 0;
  } catch (error) {
    console.error(formatError(error));
    return 1;
  }
}
