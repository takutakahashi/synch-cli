import { createServer } from "node:http";
import { hostHeaderValidation, localhostHostValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { CliAppContext } from "../app/context";
import { CliUsageError, describeError } from "../app/context";
import { CLI_VERSION } from "../config";
import { VaultNotes } from "../mcp/vault-tools";
import { McpRequestAuthorizer } from "../mcp/auth";

export async function runMcp(ctx: CliAppContext, options: { port?: string; host?: string }): Promise<number> {
  const port = parsePort(options.port);
  const host = options.host?.trim() || "127.0.0.1";
  const remote = !isLoopback(host);
  const allowedHosts = remote ? readAllowedHosts() : [];
  const authorizer = remote ? new McpRequestAuthorizer(ctx) : null;
  const handler = createVaultMcpHandler(ctx);
  const nodeHandler = toNodeHandler(handler, { onerror: (error) => ctx.logger.error(`MCP transport failed: ${describeError(error)}`) });
  const validateHost = remote ? hostHeaderValidation(allowedHosts) : localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
  const httpServer = createServer(async (req, res) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname !== "/mcp") {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found\n");
      return;
    }
    if (!validateHost(req, res) || (!remote && !validateOrigin(req, res))) return;
    if (remote) {
      const result = await authorizer!.authorize(req.headers);
      if (!result.ok) {
        res.writeHead(result.status, {
          "content-type": "application/json; charset=utf-8",
          "www-authenticate": 'Bearer realm="synch-mcp"',
        }).end(JSON.stringify({ error: result.message }));
        return;
      }
    }
    await nodeHandler(req, res);
  });
  await new Promise<void>((resolve, reject) => { httpServer.once("error", reject); httpServer.listen(port, host, resolve); });
  ctx.logger.log(`Synch MCP server listening on ${host}:${port} (/mcp)`);
  if (remote) ctx.logger.log("Remote authentication enabled (Synch bearer token + injected vault key). ");
  ctx.logger.log(`Vault: ${ctx.vaultPath}`);
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown);
      httpServer.close(() => resolve()); void handler.close();
    };
    process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
  });
  return 0;
}

export function createVaultMcpHandler(ctx: CliAppContext) {
  return createMcpHandler(() => createVaultMcpServer(ctx), {
    legacy: "stateless",
    onerror: (error) => ctx.logger.error(`MCP request failed: ${describeError(error)}`),
  });
}

export function createVaultMcpServer(ctx: CliAppContext): McpServer {
  const notes = new VaultNotes(ctx);
  const server = new McpServer({ name: "synch-vault", version: CLI_VERSION }, { instructions: "Use these tools to inspect and edit Markdown notes in the configured Synch vault." });
  server.registerTool("list_notes", { description: "List Markdown notes in the configured vault.", inputSchema: z.object({}) }, async () => toolResult(await notes.list()));
  server.registerTool("read_note", { description: "Read a Markdown note by its vault-relative path.", inputSchema: z.object({ path: z.string().describe("Vault-relative .md path") }) }, async ({ path }) => ({ content: [{ type: "text", text: await notes.read(path) }] }));
  server.registerTool("search_notes", { description: "Search Markdown note contents case-insensitively (up to 100 matching lines).", inputSchema: z.object({ query: z.string().min(1) }) }, async ({ query }) => toolResult(await notes.search(query)));
  server.registerTool("write_note", {
    description: "Create a Markdown note, or replace one when overwrite is true.",
    inputSchema: z.object({ path: z.string().describe("Vault-relative .md path"), content: z.string(), overwrite: z.boolean().default(false) }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, async ({ path, content, overwrite }) => { await notes.write(path, content, overwrite); return toolResult({ path, written: true }); });
  return server;
}

function toolResult(value: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] }; }
function parsePort(value?: string): number {
  if (value === undefined) return 3000;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65_535) throw new CliUsageError("--port must be an integer from 1 to 65535.");
  return Number(value);
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function readAllowedHosts(): string[] {
  const hosts = (process.env.SYNCH_MCP_ALLOWED_HOSTS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (hosts.length === 0) throw new CliUsageError("Remote MCP requires SYNCH_MCP_ALLOWED_HOSTS (comma-separated public hostnames).");
  return hosts;
}
