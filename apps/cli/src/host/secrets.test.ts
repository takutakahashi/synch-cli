import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CliCredentialsStore } from "./secrets";

const SELF_HOSTED = "https://synch.example.com";
const CLOUD = "https://api.synch.run";

let tempDir: string;
let credentialsPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "synch-secrets-"));
  credentialsPath = path.join(tempDir, "config", "credentials.json");
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("CliCredentialsStore", () => {
  it("round-trips the session token via the token store", async () => {
    const store = new CliCredentialsStore(credentialsPath, SELF_HOSTED);
    const tokenStore = store.createSessionTokenStore();
    expect(await tokenStore.read()).toBe("");

    await tokenStore.write("session-token");
    expect(await tokenStore.read()).toBe("session-token");

    const reloaded = new CliCredentialsStore(credentialsPath, SELF_HOSTED);
    expect(reloaded.getSessionToken()).toBe("session-token");

    await tokenStore.clear();
    expect(await tokenStore.read()).toBe("");
  });

  it("round-trips vault credentials keyed by vault path", async () => {
    const store = new CliCredentialsStore(credentialsPath, SELF_HOSTED);
    const key = new Uint8Array([1, 2, 3, 4]);
    expect(store.getVaultCredential("/vaults/a")).toBeNull();

    await store.saveVaultCredential("/vaults/a", "vault-1", {
      remoteVaultKey: key,
    });

    const reloaded = new CliCredentialsStore(credentialsPath, SELF_HOSTED);
    const credential = reloaded.getVaultCredential("/vaults/a");
    expect(credential?.remoteVaultId).toBe("vault-1");
    expect([...(credential?.secret.remoteVaultKey ?? [])]).toEqual([1, 2, 3, 4]);
    expect(reloaded.getVaultCredential("/vaults/b")).toBeNull();
  });

  it("isolates credentials per API server", async () => {
    const key = new Uint8Array([9]);
    const selfHosted = new CliCredentialsStore(credentialsPath, SELF_HOSTED);
    await selfHosted.setSessionToken("self-hosted-token");
    await selfHosted.saveVaultCredential("/vaults/a", "vault-local", {
      remoteVaultKey: key,
    });

    const cloud = new CliCredentialsStore(credentialsPath, CLOUD);
    expect(cloud.getSessionToken()).toBe("");
    expect(cloud.getVaultCredential("/vaults/a")).toBeNull();

    await cloud.setSessionToken("cloud-token");
    await cloud.saveVaultCredential("/vaults/a", "vault-cloud", {
      remoteVaultKey: key,
    });

    const rereadSelfHosted = new CliCredentialsStore(credentialsPath, SELF_HOSTED);
    expect(rereadSelfHosted.getSessionToken()).toBe("self-hosted-token");
    expect(rereadSelfHosted.getVaultCredential("/vaults/a")?.remoteVaultId).toBe(
      "vault-local",
    );
  });

  it("clears only the current server's credentials", async () => {
    const key = new Uint8Array([7]);
    const selfHosted = new CliCredentialsStore(credentialsPath, SELF_HOSTED);
    await selfHosted.setSessionToken("self-hosted-token");
    await selfHosted.saveVaultCredential("/vaults/a", "vault-local", {
      remoteVaultKey: key,
    });
    // A second vault path on the same server.
    await selfHosted.saveVaultCredential("/vaults/b", "vault-local-2", {
      remoteVaultKey: key,
    });
    await selfHosted.clearVaultCredential("/vaults/a");
    expect(selfHosted.getVaultCredential("/vaults/a")).toBeNull();
    expect(selfHosted.getVaultCredential("/vaults/b")).not.toBeNull();

    // Each store instance reads the file once, so re-open for the other server.
    await new CliCredentialsStore(credentialsPath, CLOUD).setSessionToken(
      "cloud-token",
    );

    await new CliCredentialsStore(credentialsPath, SELF_HOSTED).clearServerCredentials();
    expect(
      new CliCredentialsStore(credentialsPath, SELF_HOSTED).getSessionToken(),
    ).toBe("");
    expect(
      new CliCredentialsStore(credentialsPath, SELF_HOSTED).getVaultCredential(
        "/vaults/b",
      ),
    ).toBeNull();
    expect(new CliCredentialsStore(credentialsPath, CLOUD).getSessionToken()).toBe(
      "cloud-token",
    );
  });

  it("writes the credentials file with owner-only permissions", async () => {
    const store = new CliCredentialsStore(credentialsPath, SELF_HOSTED);
    await store.setSessionToken("secret");

    const fileMode = fs.statSync(credentialsPath).mode & 0o777;
    expect(fileMode).toBe(0o600);
    const dirMode = fs.statSync(path.dirname(credentialsPath)).mode & 0o777;
    expect(dirMode).toBe(0o700);
  });

  it("adopts version 1 credentials for the API URL in use", async () => {
    fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });
    fs.writeFileSync(
      credentialsPath,
      JSON.stringify({
        version: 1,
        sessionToken: "legacy-token",
        vaults: {
          "/vaults/a": {
            remoteVaultId: "vault-legacy",
            remoteVaultKeyBase64: Buffer.from(new Uint8Array([5, 5])).toString(
              "base64",
            ),
          },
        },
      }),
    );

    const store = new CliCredentialsStore(credentialsPath, SELF_HOSTED);
    expect(store.getSessionToken()).toBe("legacy-token");
    expect(store.getVaultCredential("/vaults/a")?.remoteVaultId).toBe("vault-legacy");

    // Another server does not inherit the migrated credentials.
    expect(
      new CliCredentialsStore(credentialsPath, CLOUD).getVaultCredential("/vaults/a"),
    ).toBeNull();
  });

  it("persists the migrated shape on load", () => {
    fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });
    fs.writeFileSync(
      credentialsPath,
      JSON.stringify({ version: 1, sessionToken: "legacy-token" }),
    );

    const store = new CliCredentialsStore(credentialsPath, SELF_HOSTED);
    expect(store.getSessionToken()).toBe("legacy-token");

    // The one-time migration is written so no other server can adopt it.
    const persisted = JSON.parse(fs.readFileSync(credentialsPath, "utf8")) as {
      version: number;
      servers: Record<string, { sessionToken?: string }>;
    };
    expect(persisted.version).toBe(2);
    expect(persisted.servers[SELF_HOSTED].sessionToken).toBe("legacy-token");
  });

  it("preserves a corrupted file as a backup and starts fresh", () => {
    fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });
    fs.writeFileSync(credentialsPath, "not json");

    const store = new CliCredentialsStore(credentialsPath, SELF_HOSTED);
    expect(store.getSessionToken()).toBe("");

    expect(fs.existsSync(credentialsPath)).toBe(false);
    const backups = fs
      .readdirSync(path.dirname(credentialsPath))
      .filter((name) => name.startsWith("credentials.json.corrupt-"));
    expect(backups).toHaveLength(1);
    expect(
      fs.readFileSync(path.join(path.dirname(credentialsPath), backups[0]), "utf8"),
    ).toBe("not json");
  });
});
