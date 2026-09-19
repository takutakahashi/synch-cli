import { CliAppContext, CliUsageError, describeError } from "./app/context";
import {
  parseCliArgs,
  resolveApiBaseUrlOrUsageError,
  resolveCommand,
  resolveOnChangeOptions,
} from "./app/cli-args";
import { runLogin } from "./commands/login";
import { runLogout } from "./commands/logout";
import { runPull } from "./commands/pull";
import { runStatus } from "./commands/status";
import { runSync } from "./commands/sync";
import { runVaultConnect } from "./commands/vault-connect";
import { runVaultCreate } from "./commands/vault-create";
import { runVaultDisconnect } from "./commands/vault-disconnect";
import { runVaultList } from "./commands/vault-list";
import { runWatch } from "./commands/watch";
import { CLI_VERSION } from "./config";
import { resolveVaultPath } from "./host/paths";

const HELP_TEXT = `synch ${CLI_VERSION} - end-to-end encrypted vault sync

Usage:
  synch login                                 Sign in with a device code
  synch logout                                Sign out and clear stored keys
  synch vault list [--json]                   List remote vaults for the account
  synch vault create --name <name>            Create a remote vault and connect this directory
  synch vault connect --vault-id <id>         Connect this directory to a remote vault
  synch vault disconnect [--json]             Forget the remote vault for this directory
  synch pull                                  Download remote changes without uploading local changes
  synch sync                                  Synchronize the vault once and exit
  synch watch [--on-change <script>]          Keep the vault in sync until interrupted
  synch status [--json]                       Show account, vault, and sync state

Options:
  --vault <path>      Vault directory (default: current directory)
  --vault-id <id>     Remote vault ID (for \`vault connect\`)
  --name <name>       Remote vault name (for \`vault create\`)
  --api-url <url>     API server URL (or SYNCH_API_URL)
  --json              Machine-readable output where supported
  --on-change <file>  Script to run (watch only) after vault changes
  --on-change-timeout <ms>  Kill the script after this delay (default 60000, 0 = never)
  -h, --help          Show this help
  -v, --version       Show version

Environment:
  SYNCH_API_URL            API server URL (default: http://127.0.0.1:8787)
  SYNCH_VAULT_PASSWORD     Vault password for non-interactive connect/create
  XDG_CONFIG_HOME          Base directory for stored credentials
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseCliArgs(argv);

  if (values.version) {
    process.stdout.write(`${CLI_VERSION}\n`);
    return 0;
  }

  const command = resolveCommand(positionals);
  if (values.help || !command) {
    process.stdout.write(HELP_TEXT);
    return values.help || positionals.length === 0 ? 0 : 2;
  }

  const onChange = resolveOnChangeOptions(command, values);

  const ctx = new CliAppContext({
    vaultPath: resolveVaultPath(values.vault),
    apiBaseUrl: resolveApiBaseUrlOrUsageError(values["api-url"]),
  });

  try {
    switch (command) {
      case "login":
        return await runLogin(ctx);
      case "logout":
        return await runLogout(ctx);
      case "vault-list":
        return await runVaultList(ctx, values.json === true);
      case "vault-create":
        return await runVaultCreate(ctx, values.name);
      case "vault-connect":
        return await runVaultConnect(ctx, values["vault-id"]);
      case "vault-disconnect":
        return await runVaultDisconnect(ctx, values.json === true);
      case "pull":
        return await runPull(ctx);
      case "sync":
        return await runSync(ctx);
      case "watch":
        return await runWatch(ctx, { onChange });
      case "status":
        return await runStatus(ctx, values.json === true);
    }
  } finally {
    await ctx.close();
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof CliUsageError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  } else {
    process.stderr.write(`error: ${describeError(error)}\n`);
    process.exitCode = 1;
  }
}
