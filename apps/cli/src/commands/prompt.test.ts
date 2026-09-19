import { afterEach, describe, expect, it, vi } from "vitest";

import {
  promptVaultPassword,
  vaultPasswordFromEnvironment,
} from "./prompt";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("vaultPasswordFromEnvironment", () => {
  it("returns null when unset or empty", () => {
    expect(vaultPasswordFromEnvironment()).toBeNull();
    vi.stubEnv("SYNCH_VAULT_PASSWORD", "");
    expect(vaultPasswordFromEnvironment()).toBeNull();
  });

  it("returns the configured value", () => {
    vi.stubEnv("SYNCH_VAULT_PASSWORD", "correct horse battery staple");
    expect(vaultPasswordFromEnvironment()).toBe("correct horse battery staple");
  });
});

describe("promptVaultPassword", () => {
  it("prefers the environment over prompting", async () => {
    vi.stubEnv("SYNCH_VAULT_PASSWORD", "correct horse battery staple");
    await expect(promptVaultPassword({ confirm: true })).resolves.toBe(
      "correct horse battery staple",
    );
  });
});
