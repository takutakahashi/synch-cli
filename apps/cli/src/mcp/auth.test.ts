import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CliAppContext } from "../app/context";
import { McpRequestAuthorizer } from "./auth";

afterEach(() => vi.unstubAllGlobals());

describe("McpRequestAuthorizer", () => {
  it("requires a valid session with vault access and the injected E2EE key", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "synch-mcp-auth-"));
    const ctx = new CliAppContext({ vaultPath: root, apiBaseUrl: "https://synch.example", credentialsPath: path.join(root, "credentials.json") });
    const key = new Uint8Array(32).fill(7);
    await ctx.credentials.saveVaultCredential(root, "vault-1", { remoteVaultKey: key });
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer user-session");
      return new Response(JSON.stringify({ vaults: [{ id: "vault-1" }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const auth = new McpRequestAuthorizer(ctx);

    await expect(auth.authorize({ authorization: "Bearer user-session", "x-synch-vault-key": Buffer.from(key).toString("base64") })).resolves.toEqual({ ok: true });
    await expect(auth.authorize({ authorization: "Bearer user-session", "x-synch-vault-key": Buffer.from(new Uint8Array(32)).toString("base64") })).resolves.toMatchObject({ ok: false, status: 403 });
    await expect(auth.authorize({ "x-synch-vault-key": Buffer.from(key).toString("base64") })).resolves.toMatchObject({ ok: false, status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await ctx.close();
    await fs.rm(root, { recursive: true, force: true });
  });
});
