import { randomBytes } from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

import type { AuthSessionTokenStore } from "@synch/sync-client/auth";
import type { StoredRemoteVaultKeySecret } from "@synch/sync-client/remote";

interface StoredVaultCredential {
  remoteVaultId: string;
  remoteVaultKeyBase64: string;
}

interface ServerCredentials {
  sessionToken?: string;
  /** Keyed by the vault directory's absolute path. */
  vaults?: Record<string, StoredVaultCredential>;
}

interface CredentialsFile {
  version: number;
  /**
   * Credentials are scoped per API server, keyed by the normalized API base
   * URL. A session token and vault key are only ever sent to the server that
   * issued them.
   */
  servers?: Record<string, ServerCredentials>;
  // Legacy (version 1) fields: a single server's credentials stored at the top
  // level. Read once and migrated into `servers` for the current API URL.
  sessionToken?: string;
  vaults?: Record<string, StoredVaultCredential>;
}

const CREDENTIALS_VERSION = 2;

/**
 * File-backed credential store (session token + per-vault key bytes).
 *
 * Secrets live outside the vault, in the CLI config directory, with 0600
 * permissions, and are isolated per API server so pointing the CLI at a
 * self-hosted deployment never reuses a token or vault key from another
 * server. State is cached in memory because the sync-client vault manager
 * reads credentials through synchronous getters.
 */
export class CliCredentialsStore {
  private state: CredentialsFile;

  constructor(
    private readonly filePath: string,
    private readonly apiBaseUrl: string,
  ) {
    const { state, migrated } = this.load();
    this.state = state;
    if (migrated) {
      // Persist the migration immediately: leaving a legacy file on disk would
      // let a later run against a different server adopt the same credentials.
      this.persistSync();
    }
  }

  /** The API base URL these credentials belong to. */
  getApiBaseUrl(): string {
    return this.apiBaseUrl;
  }

  getSessionToken(): string {
    return this.server().sessionToken ?? "";
  }

  async setSessionToken(token: string): Promise<void> {
    const server = this.serverForWrite();
    if (token) {
      server.sessionToken = token;
    } else {
      delete server.sessionToken;
    }
    await this.persist();
  }

  getVaultCredential(vaultPath: string): {
    remoteVaultId: string;
    secret: StoredRemoteVaultKeySecret;
  } | null {
    const record = this.server().vaults?.[vaultPath];
    if (!record?.remoteVaultId || !record.remoteVaultKeyBase64) {
      return null;
    }

    return {
      remoteVaultId: record.remoteVaultId,
      secret: {
        remoteVaultKey: new Uint8Array(
          Buffer.from(record.remoteVaultKeyBase64, "base64"),
        ),
      },
    };
  }

  async saveVaultCredential(
    vaultPath: string,
    remoteVaultId: string,
    secret: StoredRemoteVaultKeySecret,
  ): Promise<void> {
    const server = this.serverForWrite();
    server.vaults ??= {};
    server.vaults[vaultPath] = {
      remoteVaultId,
      remoteVaultKeyBase64: Buffer.from(secret.remoteVaultKey).toString("base64"),
    };
    await this.persist();
  }

  async clearVaultCredential(vaultPath: string): Promise<void> {
    const server = this.serverForWrite();
    if (!server.vaults?.[vaultPath]) {
      return;
    }

    delete server.vaults[vaultPath];
    await this.persist();
  }

  /** Clears this server's session token and vault keys, leaving other servers. */
  async clearServerCredentials(): Promise<void> {
    if (!this.state.servers?.[this.apiBaseUrl]) {
      return;
    }

    delete this.state.servers[this.apiBaseUrl];
    await this.persist();
  }

  createSessionTokenStore(): AuthSessionTokenStore {
    return {
      read: async () => this.getSessionToken(),
      write: async (token) => {
        await this.setSessionToken(token);
      },
      clear: async () => {
        await this.setSessionToken("");
      },
    };
  }

  private server(): ServerCredentials {
    return this.state.servers?.[this.apiBaseUrl] ?? {};
  }

  private serverForWrite(): ServerCredentials {
    this.state.servers ??= {};
    this.state.servers[this.apiBaseUrl] ??= {};
    return this.state.servers[this.apiBaseUrl];
  }

  private load(): { state: CredentialsFile; migrated: boolean } {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, "utf8");
    } catch {
      // A missing file starts a fresh credentials store.
      return { state: { version: CREDENTIALS_VERSION }, migrated: false };
    }

    try {
      const parsed = JSON.parse(raw) as CredentialsFile;
      if (parsed && typeof parsed === "object") {
        return migrateCredentials(parsed, this.apiBaseUrl);
      }
    } catch {
      // Fall through to preserving the unreadable file below.
    }

    // The file holds the session token and vault keys; move it aside for
    // manual recovery instead of silently overwriting it on the next write.
    try {
      fs.renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
    } catch {
      // Keep going with a fresh store even if the backup rename fails.
    }
    return { state: { version: CREDENTIALS_VERSION }, migrated: false };
  }

  private persistSync(): void {
    const dir = path.dirname(this.filePath);
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tempPath = `${this.filePath}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
      fs.writeFileSync(tempPath, `${JSON.stringify(this.state, null, 2)}\n`, {
        mode: 0o600,
      });
      fs.renameSync(tempPath, this.filePath);
      fs.chmodSync(this.filePath, 0o600);
    } catch {
      // The in-memory migration is still correct for this process; the next
      // successful write will persist it.
    }
  }

  private async persist(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fsPromises.mkdir(dir, { recursive: true, mode: 0o700 });
    // Process-unique temp name so concurrent CLI processes sharing the
    // credentials file never interleave a write and a rename.
    const tempPath = `${this.filePath}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
    try {
      await fsPromises.writeFile(
        tempPath,
        `${JSON.stringify(this.state, null, 2)}\n`,
        { mode: 0o600 },
      );
      await fsPromises.rename(tempPath, this.filePath);
    } catch (error) {
      await fsPromises.unlink(tempPath).catch(() => {});
      throw error;
    }
    await fsPromises.chmod(this.filePath, 0o600);
  }
}

/**
 * Version 1 files stored one server's credentials at the top level and did not
 * record which server they came from. Adopt them for the API URL currently in
 * use: that is the only server the older CLI could have talked to.
 */
function migrateCredentials(
  parsed: CredentialsFile,
  apiBaseUrl: string,
): { state: CredentialsFile; migrated: boolean } {
  const isLegacy =
    parsed.version !== CREDENTIALS_VERSION &&
    (parsed.sessionToken !== undefined || parsed.vaults !== undefined);
  if (!isLegacy) {
    return {
      state: { ...parsed, version: CREDENTIALS_VERSION },
      migrated: parsed.version !== CREDENTIALS_VERSION,
    };
  }

  const legacy: ServerCredentials = {};
  if (parsed.sessionToken !== undefined) {
    legacy.sessionToken = parsed.sessionToken;
  }
  if (parsed.vaults !== undefined) {
    legacy.vaults = parsed.vaults;
  }

  return {
    state: {
      version: CREDENTIALS_VERSION,
      servers: { ...(parsed.servers ?? {}), [apiBaseUrl]: legacy },
    },
    migrated: true,
  };
}
