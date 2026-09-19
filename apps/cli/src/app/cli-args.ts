import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { resolveApiBaseUrl } from "../config";
import { CliUsageError, describeError } from "./context";

export const CLI_OPTIONS = {
  vault: { type: "string" },
  "vault-id": { type: "string" },
  name: { type: "string" },
  "api-url": { type: "string" },
  "on-change": { type: "string" },
  "on-change-timeout": { type: "string" },
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

export const DEFAULT_ON_CHANGE_TIMEOUT_MS = 60_000;

export interface OnChangeOptions {
  /** Absolute path to the script or executable to run. */
  spec: string;
  /** Milliseconds before the script is killed; 0 disables the timeout. */
  timeoutMs: number;
}

/**
 * Validates the `--on-change` options. The hook only makes sense while
 * watching, so using it elsewhere is reported as a usage error instead of
 * being ignored.
 */
export function resolveOnChangeOptions(
  command: CliCommand,
  values: { "on-change"?: string; "on-change-timeout"?: string },
): OnChangeOptions | null {
  const spec = values["on-change"]?.trim();
  const timeoutRaw = values["on-change-timeout"]?.trim();

  if (!spec) {
    if (timeoutRaw) {
      throw new CliUsageError("--on-change-timeout requires --on-change.");
    }
    return null;
  }

  if (command !== "watch") {
    throw new CliUsageError(
      "--on-change is only supported by `synch watch`.",
    );
  }

  const resolved = path.resolve(spec);
  if (!fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()) {
    throw new CliUsageError(`--on-change script not found: ${spec}`);
  }

  let timeoutMs = DEFAULT_ON_CHANGE_TIMEOUT_MS;
  if (timeoutRaw) {
    if (!/^\d+$/.test(timeoutRaw)) {
      throw new CliUsageError(
        "--on-change-timeout must be a non-negative integer (milliseconds).",
      );
    }
    timeoutMs = Number(timeoutRaw);
  }

  return { spec: resolved, timeoutMs };
}
