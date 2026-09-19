import type { UserVisibleSyncState } from "@synch/sync-client/engine";

import type { OnChangeOptions } from "../app/cli-args";
import type { CliAppContext } from "../app/context";
import { describeError } from "../app/context";
import { formatSyncProgressSuffix, formatSyncStatusLabel } from "../app/notices";
import { OnChangeHook } from "../app/on-change-hook";
import { VaultChangeNotifier } from "../app/vault-changes";

export interface RunWatchOptions {
  /** `--on-change` hook, run after vault changes are detected. */
  onChange?: OnChangeOptions | null;
}

export async function runWatch(
  ctx: CliAppContext,
  options: RunWatchOptions = {},
): Promise<number> {
  await ctx.initializeAuth();
  ctx.requireVerifiedAuth();
  await ctx.openVaultSession();

  // The baseline snapshot is taken before the first sync so that the initial
  // materialization of the vault is reported to the hook as well.
  const notifier = createChangeNotifier(ctx, options.onChange ?? null);
  notifier?.start();

  let lastPrinted = "";
  ctx.onSyncStatusChange = () => {
    const progress =
      ctx.syncStatus === "syncing" ? formatSyncProgressSuffix(ctx.syncProgress) : "";
    const line = `status: ${formatSyncStatusLabel(ctx.syncStatus)}${progress}`;
    if (line !== lastPrinted) {
      lastPrinted = line;
      ctx.logger.log(line);
    }

    // A settled status means a sync pass finished, so this is the point where
    // files may have appeared, changed, or been removed.
    if (notifier && isSettledSyncStatus(ctx.syncStatus)) {
      notifier.schedule();
    }
  };

  let reconcilePromise: Promise<void> | null = null;
  ctx.onReconcileRequested = () => {
    if (reconcilePromise) {
      return;
    }
    reconcilePromise = (async () => {
      try {
        const result = await ctx.engine.reconcileOnce();
        if (result.filesQueuedForUpsert > 0 || result.filesQueuedForDelete > 0) {
          ctx.engine.notifyLocalChange();
        }
      } catch (error) {
        ctx.logger.error(`reconcile failed: ${describeError(error)}`);
      } finally {
        reconcilePromise = null;
      }
    })();
  };

  ctx.logger.log(`Watching ${ctx.vaultPath}`);
  ctx.engine.registerVaultEvents();
  await ctx.engine.reconcileOnce();
  await ctx.engine.waitForLocalMutationWork();
  await ctx.engine.startAutoSync();
  await ctx.engine.syncNow();
  await notifier?.flush();
  ctx.logger.log("Watching for changes. Press Ctrl+C to stop.");

  await waitForShutdownSignal();
  notifier?.dispose();
  await notifier?.settle();
  ctx.logger.log("Stopping...");
  return 0;
}

function createChangeNotifier(
  ctx: CliAppContext,
  onChange: OnChangeOptions | null,
): VaultChangeNotifier | null {
  if (!onChange) {
    return null;
  }

  const hook = new OnChangeHook({
    spec: onChange.spec,
    cwd: ctx.vaultPath,
    logger: ctx.logger,
    timeoutMs: onChange.timeoutMs,
  });
  ctx.logger.log(
    `On change: ${hook.display} (timeout ${
      onChange.timeoutMs === 0 ? "disabled" : `${onChange.timeoutMs}ms`
    })`,
  );

  return new VaultChangeNotifier({
    vaultPath: ctx.vaultPath,
    apiBaseUrl: ctx.apiBaseUrl,
    hook,
    shouldSyncPath: (path) => ctx.engine.shouldSyncPath(path),
    logger: ctx.logger,
  });
}

/** True when the engine is not in the middle of a sync or reconcile pass. */
function isSettledSyncStatus(status: UserVisibleSyncState): boolean {
  return (
    status !== "syncing" && status !== "reconciling" && status !== "reconnecting"
  );
}

function waitForShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    const onSignal = () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolve();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  });
}
