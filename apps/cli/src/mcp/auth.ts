import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { RemoteVaultClient } from "@synch/sync-client/remote";
import type { CliAppContext } from "../app/context";
import { defaultHttpClient } from "../host/http";

type AuthResult = { ok: true } | { ok: false; status: 401 | 403; message: string };

export class McpRequestAuthorizer {
  private readonly client = new RemoteVaultClient(defaultHttpClient);

  constructor(private readonly ctx: CliAppContext) {}

  async authorize(headers: IncomingHttpHeaders): Promise<AuthResult> {
    const token = bearerToken(singleHeader(headers.authorization));
    if (!token) return { ok: false, status: 401, message: "A Synch bearer token is required." };

    const encodedKey = singleHeader(headers["x-synch-vault-key"]);
    const suppliedKey = decodeBase64Key(encodedKey);
    const credential = this.ctx.credentials.getVaultCredential(this.ctx.vaultPath);
    if (!suppliedKey || !credential || !sameBytes(suppliedKey, credential.secret.remoteVaultKey)) {
      return { ok: false, status: 403, message: "The injected vault key is invalid." };
    }

    try {
      const { vaults } = await this.client.listRemoteVaults(this.ctx.apiBaseUrl, token);
      if (!vaults.some((vault) => vault.id === credential.remoteVaultId)) {
        return { ok: false, status: 403, message: "The user cannot access this vault." };
      }
    } catch {
      return { ok: false, status: 401, message: "The Synch session is invalid or expired." };
    }
    return { ok: true };
  }
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? undefined : value;
}

function bearerToken(value: string | undefined): string | null {
  const match = /^Bearer ([^\s]+)$/i.exec(value ?? "");
  return match?.[1] ?? null;
}

function decodeBase64Key(value: string | undefined): Uint8Array | null {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.length > 0 && decoded.toString("base64") === value ? new Uint8Array(decoded) : null;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}
