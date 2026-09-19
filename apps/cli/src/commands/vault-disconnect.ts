import type { CliAppContext } from "../app/context";
import { writeJson, writeStdout } from "../app/output";

/**
 * Forgets the remote vault bound to this directory.
 *
 * The local sync store under `.synch/` is intentionally left in place: it holds
 * the pull cursor and cached entry state, and deleting it would make the next
 * connect look like a fresh device. Local files are never touched.
 */
export async function runVaultDisconnect(
  ctx: CliAppContext,
  json: boolean,
): Promise<number> {
  await ctx.initializeAuth();

  const credential = ctx.credentials.getVaultCredential(ctx.vaultPath);
  if (!credential) {
    if (json) {
      writeJson({ vaultPath: ctx.vaultPath, disconnected: false });
    } else {
      writeStdout("This directory is not connected to a remote vault.");
    }
    return 0;
  }

  await ctx.remoteVaultManager.disconnectRemoteVault();

  if (json) {
    writeJson({
      vaultPath: ctx.vaultPath,
      disconnected: true,
      remoteVaultId: credential.remoteVaultId,
    });
  } else {
    writeStdout(`Disconnected ${ctx.vaultPath} from vault ${credential.remoteVaultId}.`);
    writeStdout("Local files and sync state were left untouched.");
  }

  return 0;
}
