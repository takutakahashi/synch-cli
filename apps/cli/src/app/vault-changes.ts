import fs from "node:fs";
import path from "node:path";

import { VAULT_STATE_DIR_NAME } from "../host/paths";
import type { Logger } from "./notices";
import type {
  OnChangeHook,
  VaultChange,
  VaultChangedEvent,
} from "./on-change-hook";

export interface VaultFileState {
  size: number;
  mtimeMs: number;
}

export type VaultSnapshot = Map<string, VaultFileState>;

/**
 * Captures the syncable files in a vault with their size and mtime.
 *
 * The snapshot is intentionally cheap (no hashing): it is taken around sync
 * activity, where a same-millisecond rewrite of an identical-size file is not
 * a realistic miss.
 */
export function readVaultSnapshot(
  vaultPath: string,
  shouldSyncPath: (relativePath: string) => boolean,
): VaultSnapshot {
  const snapshot: VaultSnapshot = new Map();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(vaultPath, {
      recursive: true,
      withFileTypes: true,
    });
  } catch {
    // A vault directory that cannot be listed yet reads as empty.
    return snapshot;
  }

  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSymbolicLink()) {
      continue;
    }

    const parentPath = entry.parentPath ?? vaultPath;
    const absolutePath = path.join(parentPath, entry.name);
    const relativePath = path.relative(vaultPath, absolutePath).split(path.sep).join("/");
    if (
      relativePath === VAULT_STATE_DIR_NAME ||
      relativePath.startsWith(`${VAULT_STATE_DIR_NAME}/`)
    ) {
      continue;
    }
    if (!shouldSyncPath(relativePath)) {
      continue;
    }

    const stat = fs.statSync(absolutePath, { throwIfNoEntry: false });
    if (!stat?.isFile()) {
      continue;
    }
    snapshot.set(relativePath, { size: stat.size, mtimeMs: stat.mtimeMs });
  }

  return snapshot;
}

export function diffVaultSnapshots(
  previous: VaultSnapshot | null,
  next: VaultSnapshot,
): VaultChange[] {
  const changes: VaultChange[] = [];
  const before = previous ?? new Map<string, VaultFileState>();

  for (const [relativePath, state] of next) {
    const previousState = before.get(relativePath);
    if (!previousState) {
      changes.push({ path: relativePath, kind: "created" });
      continue;
    }
    if (
      previousState.size !== state.size ||
      previousState.mtimeMs !== state.mtimeMs
    ) {
      changes.push({ path: relativePath, kind: "modified" });
    }
  }

  for (const relativePath of before.keys()) {
    if (!next.has(relativePath)) {
      changes.push({ path: relativePath, kind: "deleted" });
    }
  }

  return changes.sort((left, right) => left.path.localeCompare(right.path));
}

export interface VaultChangeNotifierOptions {
  vaultPath: string;
  apiBaseUrl: string;
  hook: OnChangeHook;
  /** Restricts detection to the paths the sync engine would transfer. */
  shouldSyncPath: (relativePath: string) => boolean;
  logger: Logger;
  debounceMs?: number;
}

/**
 * Detects vault changes around sync activity and runs the `--on-change`
 * script once per settled batch.
 *
 * Detection is debounced and serialized: a hook that is still running absorbs
 * any further changes into its queue, so a burst of edits produces one run
 * with the merged change list.
 */
export class VaultChangeNotifier {
  private snapshot: VaultSnapshot | null = null;
  private timer: NodeJS.Timeout | null = null;
  private chain: Promise<void> = Promise.resolve();
  private disposed = false;
  private readonly debounceMs: number;

  constructor(private readonly options: VaultChangeNotifierOptions) {
    this.debounceMs = options.debounceMs ?? 500;
  }

  /** Records the baseline snapshot; call before the first sync pass. */
  start(): void {
    this.snapshot = this.read();
  }

  /** Requests a detection pass after `debounceMs` of quiet. */
  schedule(): void {
    if (this.disposed || this.timer) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      this.queue();
    }, this.debounceMs);
    this.timer.unref?.();
  }

  /** Runs a detection pass now and waits for it (and any hook) to finish. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.queue();
    await this.chain;
  }

  /** Stops scheduling new passes; an in-flight hook still completes. */
  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Waits for an in-flight detection pass and hook. */
  async settle(): Promise<void> {
    await this.chain;
  }

  private queue(): void {
    if (this.disposed) {
      return;
    }

    this.chain = this.chain
      .then(async () => {
        await this.detect();
      })
      .catch((error) => {
        this.options.logger.error(
          `change detection failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  private async detect(): Promise<void> {
    if (this.disposed) {
      return;
    }

    const next = this.read();
    const changes = diffVaultSnapshots(this.snapshot, next);
    this.snapshot = next;
    if (changes.length === 0) {
      return;
    }

    const event: VaultChangedEvent = {
      event: "vault.changed",
      vault: this.options.vaultPath,
      apiBaseUrl: this.options.apiBaseUrl,
      detectedAt: new Date().toISOString(),
      changes,
    };
    this.options.logger.log(
      `Detected ${changes.length} change${changes.length === 1 ? "" : "s"}; running ${this.options.hook.display}.`,
    );
    await this.options.hook.run(event);
  }

  private read(): VaultSnapshot {
    return readVaultSnapshot(this.options.vaultPath, this.options.shouldSyncPath);
  }
}
