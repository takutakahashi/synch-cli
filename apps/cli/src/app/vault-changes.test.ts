import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Logger } from "./notices";
import type { OnChangeHook, VaultChangedEvent } from "./on-change-hook";
import {
  VaultChangeNotifier,
  diffVaultSnapshots,
  readVaultSnapshot,
} from "./vault-changes";

let vaultPath: string;

const logger: Logger = { log: () => {}, error: () => {} };

beforeEach(() => {
  vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "synch-changes-"));
});

afterEach(() => {
  fs.rmSync(vaultPath, { recursive: true, force: true });
});

function write(relativePath: string, contents: string): void {
  const absolute = path.join(vaultPath, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, contents);
}

function createFakeHook(): { hook: OnChangeHook; runs: VaultChangedEvent[] } {
  const runs: VaultChangedEvent[] = [];
  const hook = {
    display: "fake hook",
    run: async (event: VaultChangedEvent) => {
      runs.push(event);
    },
  };
  return { hook: hook as unknown as OnChangeHook, runs };
}

describe("readVaultSnapshot", () => {
  it("captures syncable files and skips the state dir and filtered paths", () => {
    write("notes/a.md", "hello");
    write(".obsidian/workspace.json", "{}");
    write(".synch/sync.sqlite", "state");

    const snapshot = readVaultSnapshot(
      vaultPath,
      (relativePath) => !relativePath.startsWith(".obsidian/"),
    );

    expect([...snapshot.keys()]).toEqual(["notes/a.md"]);
    expect(snapshot.get("notes/a.md")?.size).toBe(5);
  });

  it("returns an empty snapshot for a missing directory", () => {
    expect(readVaultSnapshot(path.join(vaultPath, "nope"), () => true).size).toBe(0);
  });
});

describe("diffVaultSnapshots", () => {
  it("reports created, modified, deleted, and unchanged files", () => {
    const previous = new Map([
      ["kept.md", { size: 1, mtimeMs: 1 }],
      ["edited.md", { size: 1, mtimeMs: 1 }],
      ["removed.md", { size: 1, mtimeMs: 1 }],
    ]);
    const next = new Map([
      ["kept.md", { size: 1, mtimeMs: 1 }],
      ["edited.md", { size: 2, mtimeMs: 1 }],
      ["added.md", { size: 1, mtimeMs: 1 }],
    ]);

    expect(diffVaultSnapshots(previous, next)).toEqual([
      { path: "added.md", kind: "created" },
      { path: "edited.md", kind: "modified" },
      { path: "removed.md", kind: "deleted" },
    ]);
  });

  it("treats a missing baseline as all-created", () => {
    expect(
      diffVaultSnapshots(null, new Map([["a.md", { size: 1, mtimeMs: 1 }]])),
    ).toEqual([{ path: "a.md", kind: "created" }]);
  });
});

describe("VaultChangeNotifier", () => {
  function createNotifier() {
    const { hook, runs } = createFakeHook();
    const notifier = new VaultChangeNotifier({
      vaultPath,
      apiBaseUrl: "https://synch.example.com",
      hook,
      shouldSyncPath: () => true,
      logger,
    });
    return { notifier, runs };
  }

  it("runs the hook once with the merged change list", async () => {
    const { notifier, runs } = createNotifier();
    notifier.start();

    write("a.md", "one");
    write("b.md", "two");
    await notifier.flush();

    expect(runs).toHaveLength(1);
    expect(runs[0].event).toBe("vault.changed");
    expect(runs[0].vault).toBe(vaultPath);
    expect(runs[0].apiBaseUrl).toBe("https://synch.example.com");
    expect(runs[0].changes).toEqual([
      { path: "a.md", kind: "created" },
      { path: "b.md", kind: "created" },
    ]);
  });

  it("stays quiet when nothing changed and reports deletions later", async () => {
    write("a.md", "one");
    const { notifier, runs } = createNotifier();
    notifier.start();

    await notifier.flush();
    expect(runs).toHaveLength(0);

    fs.rmSync(path.join(vaultPath, "a.md"));
    await notifier.flush();
    expect(runs).toHaveLength(1);
    expect(runs[0].changes).toEqual([{ path: "a.md", kind: "deleted" }]);
  });

  it("reports the initial materialization and ignores .synch state", async () => {
    const { notifier, runs } = createNotifier();
    notifier.start();

    write("pulled.md", "from remote");
    write(".synch/sync.sqlite", "state");
    await notifier.flush();

    expect(runs).toHaveLength(1);
    expect(runs[0].changes).toEqual([{ path: "pulled.md", kind: "created" }]);
  });

  it("serializes overlapping detection passes", async () => {
    const started: string[] = [];
    const releases: Array<() => void> = [];
    const hook = {
      display: "blocking hook",
      run: async (event: VaultChangedEvent) => {
        started.push(event.changes.map((change) => change.path).join(","));
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
      },
    };
    const notifier = new VaultChangeNotifier({
      vaultPath,
      apiBaseUrl: "http://127.0.0.1:8787",
      hook: hook as unknown as OnChangeHook,
      shouldSyncPath: () => true,
      logger,
      debounceMs: 1,
    });
    notifier.start();

    write("a.md", "one");
    notifier.schedule();
    await vi.waitFor(() => {
      expect(started).toHaveLength(1);
    });

    // A change detected while the hook is running must not start a second run.
    write("b.md", "two");
    notifier.schedule();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started).toEqual(["a.md"]);

    releases.shift()?.();
    await vi.waitFor(() => {
      expect(started).toHaveLength(2);
    });
    releases.shift()?.();
    await notifier.settle();
    notifier.dispose();

    expect(started).toEqual(["a.md", "b.md"]);
  });
});
