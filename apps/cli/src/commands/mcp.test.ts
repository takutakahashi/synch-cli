import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { describe, expect, it } from "vitest";

import { CliAppContext } from "../app/context";
import { createVaultMcpHandler } from "./mcp";

describe("MCP Streamable HTTP server", () => {
  it("negotiates the protocol and serves vault tools", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "synch-mcp-http-"));
    const ctx = new CliAppContext({
      vaultPath: root,
      apiBaseUrl: "http://127.0.0.1:8787",
      credentialsPath: path.join(root, "credentials.json"),
    });
    const handler = createVaultMcpHandler(ctx);
    const server = createServer(toNodeHandler(handler));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");

    const client = new Client({ name: "synch-test", version: "1.0.0" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)));
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
        "list_notes", "read_note", "search_notes", "write_note",
      ]);
      const written = await client.callTool({ name: "write_note", arguments: { path: "hello.md", content: "Hello MCP" } });
      expect(written.isError).not.toBe(true);
      const read = await client.callTool({ name: "read_note", arguments: { path: "hello.md" } });
      expect(read.content).toEqual([{ type: "text", text: "Hello MCP" }]);
    } finally {
      await client.close();
      await handler.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
