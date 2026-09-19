import { CliUsageError } from "../app/context";

export async function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  const stderr = process.stderr;

  if (!stdin.isTTY) {
    return await readStdinLine();
  }

  stderr.write(question);
  return await new Promise<string>((resolve, reject) => {
    stdin.setRawMode(true);
    stdin.resume();
    let value = "";

    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stderr.write("\n");
    };

    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          cleanup();
          reject(new Error("Canceled."));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };

    stdin.on("data", onData);
  });
}

async function readStdinLine(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) {
    data += chunk.toString("utf8");
    const newlineIndex = data.indexOf("\n");
    if (newlineIndex >= 0) {
      return data.slice(0, newlineIndex).replace(/\r$/, "");
    }
  }

  return data.replace(/\r$/, "");
}

/**
 * Password entry shared by `vault connect` and `vault create`.
 *
 * Interactive terminals are prompted twice when a confirmation is requested.
 * Non-interactive callers (CI, containers) can provide `SYNCH_VAULT_PASSWORD`
 * instead, which skips the prompt and the confirmation read.
 */
export function vaultPasswordFromEnvironment(): string | null {
  const value = process.env.SYNCH_VAULT_PASSWORD;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function promptVaultPassword(
  options: { confirm: boolean; prompt?: string } = { confirm: false },
): Promise<string> {
  const fromEnvironment = vaultPasswordFromEnvironment();
  if (fromEnvironment !== null) {
    return fromEnvironment;
  }

  const password = await promptHidden(options.prompt ?? "Vault password: ");
  if (!options.confirm) {
    return password;
  }

  const confirmation = await promptHidden("Confirm password: ");
  if (password !== confirmation) {
    throw new CliUsageError("Passwords do not match.");
  }

  return password;
}
