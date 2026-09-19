import { afterEach, describe, expect, it, vi } from "vitest";

import type { CliAppContext } from "../app/context";
import { runVaultList } from "./vault-list";

function createContext(options: {
  vaults: Array<{ id: string; name: string }>;
  connectedVaultId?: string | null;
}): CliAppContext {
  return {
    vaultPath: "/vault",
    apiBaseUrl: "https://api.example",
    logger: { log: vi.fn(), error: vi.fn() },
    initializeAuth: vi.fn(async () => ({ state: "verified", token: "token" })),
    requireVerifiedAuth: vi.fn(),
    remoteVaultManager: {
      listRemoteVaults: vi.fn(async () =>
        options.vaults.map((vault) => ({
          id: vault.id,
          name: vault.name,
          organizationId: "org_1",
          activeKeyVersion: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
        })),
      ),
    },
    credentials: {
      getVaultCredential: vi.fn(() =>
        options.connectedVaultId
          ? {
              remoteVaultId: options.connectedVaultId,
              secret: { remoteVaultKey: new Uint8Array() },
            }
          : null,
      ),
    },
  } as unknown as CliAppContext;
}

function captureStdout(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    });
  return { lines, restore: () => spy.mockRestore() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runVaultList", () => {
  it("marks the vault connected to this directory", async () => {
    const ctx = createContext({
      vaults: [
        { id: "v1", name: "Notes" },
        { id: "v2", name: "Archive" },
      ],
      connectedVaultId: "v2",
    });
    const stdout = captureStdout();
    try {
      expect(await runVaultList(ctx, false)).toBe(0);
    } finally {
      stdout.restore();
    }

    const output = stdout.lines.join("");
    expect(output).toContain("  v1  Notes");
    expect(output).toContain("* v2  Archive");
  });

  it("emits structured JSON with the connected vault id", async () => {
    const ctx = createContext({
      vaults: [{ id: "v1", name: "Notes" }],
      connectedVaultId: "v1",
    });
    const stdout = captureStdout();
    try {
      expect(await runVaultList(ctx, true)).toBe(0);
    } finally {
      stdout.restore();
    }

    const parsed = JSON.parse(stdout.lines.join(""));
    expect(parsed).toEqual({
      apiBaseUrl: "https://api.example",
      connectedVaultId: "v1",
      vaults: [
        {
          id: "v1",
          name: "Notes",
          organizationId: "org_1",
          activeKeyVersion: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
  });

  it("explains how to create the first vault", async () => {
    const ctx = createContext({ vaults: [], connectedVaultId: null });
    const stdout = captureStdout();
    try {
      expect(await runVaultList(ctx, false)).toBe(0);
    } finally {
      stdout.restore();
    }

    expect(stdout.lines.join("")).toContain("synch vault create --name");
  });
});
