import { afterEach, describe, expect, it, vi } from "vitest";

import type { CliAppContext } from "../app/context";
import { CliUsageError } from "../app/context";
import { runVaultCreate } from "./vault-create";

const VALID_PASSWORD = "correct horse battery staple";

function createContext() {
  return {
    vaultPath: "/vault",
    logger: { log: vi.fn(), error: vi.fn() },
    authManager: {},
    credentials: {},
    initializeAuth: vi.fn(async () => ({ state: "verified", token: "token" })),
    requireVerifiedAuth: vi.fn(),
    openVaultSession: vi.fn(async () => {}),
    remoteVaultManager: {
      createRemoteVault: vi.fn(async (input: { name: string }) => ({
        vaultId: "v_1",
        vaultName: input.name,
        activeKeyVersion: 1,
        bootstrappedAt: null,
      })),
    },
  } as unknown as CliAppContext;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runVaultCreate", () => {
  it("requires a vault name", async () => {
    await expect(runVaultCreate(createContext(), undefined)).rejects.toBeInstanceOf(
      CliUsageError,
    );
  });

  it("rejects a password that does not satisfy the vault policy", async () => {
    vi.stubEnv("SYNCH_VAULT_PASSWORD", "short");
    const ctx = createContext();
    await expect(runVaultCreate(ctx, "Notes")).rejects.toThrow(
      /at least 12 characters/,
    );
    expect(ctx.remoteVaultManager.createRemoteVault).not.toHaveBeenCalled();
  });

  it("creates the vault and binds the local directory", async () => {
    vi.stubEnv("SYNCH_VAULT_PASSWORD", VALID_PASSWORD);
    const ctx = createContext();

    expect(await runVaultCreate(ctx, "  Notes  ")).toBe(0);
    expect(ctx.remoteVaultManager.createRemoteVault).toHaveBeenCalledWith({
      name: "Notes",
      password: VALID_PASSWORD,
      confirmPassword: VALID_PASSWORD,
    });
    expect(ctx.openVaultSession).toHaveBeenCalledOnce();
    expect(ctx.logger.log).toHaveBeenCalledWith(
      expect.stringContaining('Created vault "Notes"'),
    );
  });
});
