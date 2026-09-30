import { createServer } from "node:http";
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { CliAppContext } from "../app/context";
import { CliUsageError, describeError } from "../app/context";
import { CLI_VERSION } from "../config";
import { VaultNotes } from "../mcp/vault-tools";

export async function runMcp(ctx: CliAppContext, rawPort?: string): Promise<number> {
  const port = parsePort(rawPort);
  const handler = createVaultMcpHandler(ctx);
  const nodeHandler = toNodeHandler(handler, { onerror: (error) => ctx.logger.error(`MCP transport failed: ${describeError(error)}`) });
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
  const httpServer = createServer(async (req, res) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname !== "/mcp") {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found\n");
      return;
    }
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    await nodeHandler(req, res);
  });
  await new Promise<void>((resolve, reject) => { httpServer.once("error", reject); httpServer.listen(port, "127.0.0.1", resolve); });
  ctx.logger.log(`Synch MCP server listening at http://127.0.0.1:${port}/mcp`);
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
