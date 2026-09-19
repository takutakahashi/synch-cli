import fs from "node:fs";

import type { CliAppContext } from "../app/context";
import { writeJson, writeStdout } from "../app/output";
import { vaultSyncStorePath } from "../host/paths";
import { SqliteSyncStore } from "../host/sqlite-store";

interface LocalSyncState {
  initialized: boolean;
  localVaultId: string | null;
  lastPulledCursor: number | null;
  completedEntries: number;
  totalEntries: number;
  pendingLocalChanges: boolean;
}

export async function runStatus(
  ctx: CliAppContext,
  json: boolean,
): Promise<number> {
  await ctx.initializeAuth();

  const account = ctx.authManager.getAuthStatus();
  const credential = ctx.credentials.getVaultCredential(ctx.vaultPath);
  const localState = await readLocalSyncState(ctx.vaultPath);

  if (json) {
    writeJson({
      vaultPath: ctx.vaultPath,
      apiBaseUrl: ctx.apiBaseUrl,
      account: {
        state: account.state,
        displayName: account.state === "signed_in" ? account.displayName : null,
      },
      remoteVault: credential
        ? { remoteVaultId: credential.remoteVaultId }
        : null,
      localState,
    });
    return 0;
  }

  writeStdout(`Vault: ${ctx.vaultPath}`);
  writeStdout(`API server: ${ctx.apiBaseUrl}`);
  writeStdout(`Account: ${formatAccount(account)}`);

  if (!credential) {
    writeStdout("Remote vault: not connected (run `synch vault connect`)");
    return 0;
  }
  writeStdout(`Remote vault: ${credential.remoteVaultId}`);

  if (!localState.initialized) {
    writeStdout("Local sync state: not initialized");
    return 0;
  }

  writeStdout(`Local vault ID: ${localState.localVaultId}`);
  writeStdout(`Last pulled cursor: ${localState.lastPulledCursor}`);
  writeStdout(
    `Entries: ${localState.completedEntries}/${localState.totalEntries} synced`,
  );
  writeStdout(
    `Pending local changes: ${localState.pendingLocalChanges ? "yes" : "no"}`,
  );

  return 0;
}

/**
 * Reads the local sync store without taking the vault lock so `status` works
 * while `watch` runs. Reads are safe under WAL with busy_timeout, and `open()`
 * only performs idempotent schema setup on an existing database.
 */
async function readLocalSyncState(vaultPath: string): Promise<LocalSyncState> {
  const dbPath = vaultSyncStorePath(vaultPath);
  if (!fs.existsSync(dbPath)) {
    return {
      initialized: false,
      localVaultId: null,
      lastPulledCursor: null,
      completedEntries: 0,
      totalEntries: 0,
      pendingLocalChanges: false,
    };
  }

  const store = SqliteSyncStore.open(dbPath);
  try {
    const connection = await store.readSyncConnection();
    const progress = await store.countSyncProgress();
    const pending = await store.listDirtyEntries(1);
    return {
      initialized: true,
      localVaultId: connection?.localVaultId ?? (await store.readLocalVaultId()),
      lastPulledCursor: connection?.lastPulledCursor ?? 0,
      completedEntries: progress.completedEntries,
      totalEntries: progress.totalEntries,
      pendingLocalChanges: pending.length > 0,
    };
  } finally {
    await store.close();
  }
}

type AuthStatus = ReturnType<CliAppContext["authManager"]["getAuthStatus"]>;

function formatAccount(status: AuthStatus): string {
  switch (status.state) {
    case "signed_in":
      return `signed in as ${status.displayName}`;
    case "pending_network":
      return "stored session (network unreachable)";
    case "needs_relogin":
      return "session rejected; run `synch login`";
    case "not_signed_in":
      return "not signed in";
  }
}
