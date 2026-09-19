import { parseArgs } from "node:util";

import { resolveApiBaseUrl } from "../config";
import { CliUsageError, describeError } from "./context";

export const CLI_OPTIONS = {
  vault: { type: "string" },
  "vault-id": { type: "string" },
  name: { type: "string" },
  "api-url": { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

interface CliParseArgsConfig {
  args: string[];
  allowPositionals: true;
  options: typeof CLI_OPTIONS;
}

export type CliCommand =
  | "login"
  | "logout"
  | "vault-list"
  | "vault-create"
  | "vault-connect"
  | "vault-disconnect"
  | "pull"
  | "sync"
  | "watch"
  | "status";

export function parseCliArgs(
  argv: string[],
): ReturnType<typeof parseArgs<CliParseArgsConfig>> {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: CLI_OPTIONS,
    });
  } catch (error) {
    // Unknown or malformed flags are usage errors (exit code 2), not crashes.
    throw new CliUsageError(
      `${describeError(error)}\nRun \`synch --help\` for usage.`,
    );
  }
}

export function resolveCommand(positionals: string[]): CliCommand | null {
  const [first, second] = positionals;
  switch (first) {
    case "login":
    case "logout":
    case "pull":
    case "sync":
    case "watch":
    case "status":
      return positionals.length === 1 ? first : null;
    case "vault":
      if (positionals.length !== 2) {
        return null;
      }
      switch (second) {
        case "list":
          return "vault-list";
        case "create":
          return "vault-create";
        case "connect":
          return "vault-connect";
        case "disconnect":
          return "vault-disconnect";
        default:
          return null;
      }
    default:
      return null;
  }
}

/** A malformed `--api-url` is a usage error (exit code 2), not a crash. */
export function resolveApiBaseUrlOrUsageError(
  flagValue: string | undefined,
): string {
  try {
    return resolveApiBaseUrl(flagValue);
  } catch (error) {
    throw new CliUsageError(describeError(error));
  }
}
