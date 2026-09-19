import { spawn } from "node:child_process";
import path from "node:path";

import { CliUsageError } from "./context";
import type { Logger } from "./notices";

export interface VaultChange {
  path: string;
  kind: "created" | "modified" | "deleted";
}

export interface VaultChangedEvent {
  event: "vault.changed";
  vault: string;
  apiBaseUrl: string;
  detectedAt: string;
  changes: VaultChange[];
}

export interface OnChangeHookOptions {
  /** Script path (Node script) or executable to run. */
  spec: string;
  cwd: string;
  logger: Logger;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  execPath?: string;
  nodeVersion?: string;
  typescriptSupport?: string | false;
}

const NODE_SCRIPT_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
]);
const TYPE_SCRIPT_EXTENSIONS = new Set([".ts", ".mts", ".cts"]);

/**
 * Runs a user script after `synch watch` detects vault changes.
 *
 * Node scripts are executed with the CLI's own Node binary, so `.ts`/`.mts`
 * hooks work wherever the runtime supports type stripping. Any other path is
 * executed directly, which covers shell scripts and compiled binaries. The
 * event is passed as JSON on stdin and mirrored in `SYNCH_*` environment
 * variables.
 */
export class OnChangeHook {
  private readonly command: { command: string; args: string[]; display: string };
  private readonly timeoutMs: number;

  constructor(private readonly options: OnChangeHookOptions) {
    if (!path.isAbsolute(options.spec)) {
      throw new CliUsageError(`--on-change expects a path; got "${options.spec}".`);
    }

    this.command = resolveHookCommand(options.spec, {
      execPath: options.execPath ?? process.execPath,
      nodeVersion: options.nodeVersion ?? process.versions.node,
      typescriptSupport:
        options.typescriptSupport ??
        (process.features as { typescript?: string | false } | undefined)?.typescript,
    });
    this.timeoutMs = options.timeoutMs;
  }

  /** Command line that will be executed, for logging. */
  get display(): string {
    return this.command.display;
  }

  async run(event: VaultChangedEvent): Promise<void> {
    const payload = JSON.stringify(event);
    await new Promise<void>((resolve) => {
      const child = spawn(this.command.command, this.command.args, {
        cwd: this.options.cwd,
        env: {
          ...(this.options.env ?? process.env),
          SYNCH_EVENT: event.event,
          SYNCH_VAULT: event.vault,
          SYNCH_API_URL: event.apiBaseUrl,
          SYNCH_CHANGED_FILES: event.changes.map((change) => change.path).join("\n"),
        },
        // The hook's own output belongs to the user, so let it stream through.
        stdio: ["pipe", "inherit", "inherit"],
      });

      let settled = false;
      let timer: NodeJS.Timeout | null = null;

      const finish = (message: string | null) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        if (message) {
          this.options.logger.error(message);
        }
        resolve();
      };

      if (this.timeoutMs > 0) {
        timer = setTimeout(() => {
          child.kill("SIGKILL");
          finish(
            `--on-change script timed out after ${this.timeoutMs}ms: ${this.command.display}`,
          );
        }, this.timeoutMs);
        timer.unref?.();
      }

      child.on("error", (error) => {
        finish(`--on-change script failed to start: ${error.message}`);
      });
      child.on("close", (code, signal) => {
        if (code === 0) {
          finish(null);
          return;
        }
        finish(
          `--on-change script exited with ${
            signal ? `signal ${signal}` : `code ${code}`
          }: ${this.command.display}`,
        );
      });

      child.stdin?.on("error", () => {
        // The child may exit before reading stdin; the close handler reports it.
      });
      child.stdin?.end(payload);
    });
  }
}

export function resolveHookCommand(
  spec: string,
  runtime: {
    execPath: string;
    nodeVersion: string;
    typescriptSupport: string | false | undefined;
  },
): { command: string; args: string[]; display: string } {
  const resolved = path.resolve(spec);
  const extension = path.extname(resolved).toLowerCase();

  if (!NODE_SCRIPT_EXTENSIONS.has(extension)) {
    return { command: resolved, args: [], display: resolved };
  }

  const nodeArgs: string[] = [];
  if (TYPE_SCRIPT_EXTENSIONS.has(extension)) {
    const typeScriptArgs = typeScriptStrippingArgs(runtime);
    if (typeScriptArgs === null) {
      throw new CliUsageError(
        `TypeScript hooks need Node 22.6+ (found ${runtime.nodeVersion}). ` +
          `Use a .mjs hook or run it through tsx.`,
      );
    }
    // A hook rarely lives in a package with "type": "module"; the typeless
    // warning would otherwise print on every run.
    nodeArgs.push("--disable-warning=MODULE_TYPELESS_PACKAGE_JSON");
    nodeArgs.push(...typeScriptArgs);
  }
  nodeArgs.push(resolved);

  const display = [runtime.execPath, ...nodeArgs].join(" ");
  return { command: runtime.execPath, args: nodeArgs, display };
}

/**
 * Returns the extra Node flags needed to run a TypeScript hook, an empty array
 * when the runtime strips types by default, or null when it cannot.
 */
function typeScriptStrippingArgs(runtime: {
  nodeVersion: string;
  typescriptSupport: string | false | undefined;
}): string[] | null {
  if (runtime.typescriptSupport) {
    return [];
  }

  const [major, minor] = runtime.nodeVersion.split(".").map((part) => Number(part));
  if (major > 22 || (major === 22 && minor >= 6)) {
    return ["--experimental-strip-types"];
  }

  return null;
}
