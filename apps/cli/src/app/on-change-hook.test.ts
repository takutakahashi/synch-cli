import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Logger } from "./notices";
import { CliUsageError } from "./context";
import { OnChangeHook, resolveHookCommand } from "./on-change-hook";

let tempDir: string;

const NODE_24 = { execPath: "/usr/bin/node", nodeVersion: "24.9.0", typescriptSupport: "strip" as const };
const NODE_22_6 = { execPath: "/usr/bin/node", nodeVersion: "22.6.0", typescriptSupport: undefined };
const NODE_22_5 = { execPath: "/usr/bin/node", nodeVersion: "22.5.0", typescriptSupport: undefined };

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "synch-hook-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function createLogger(): Logger & { errors: string[] } {
  const errors: string[] = [];
  return {
    errors,
    log: () => {},
    error: (message: string) => {
      errors.push(message);
    },
  };
}

function writeScript(name: string, source: string): string {
  const file = path.join(tempDir, name);
  fs.writeFileSync(file, source);
  return file;
}

describe("resolveHookCommand", () => {
  it("runs Node scripts with the CLI's own interpreter", () => {
    const resolved = resolveHookCommand("/hooks/after.mjs", NODE_24);
    expect(resolved.command).toBe("/usr/bin/node");
    expect(resolved.args).toEqual(["/hooks/after.mjs"]);
  });

  it("relies on native type stripping when available", () => {
    const resolved = resolveHookCommand("/hooks/after.ts", NODE_24);
    expect(resolved.args).toEqual([
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "/hooks/after.ts",
    ]);
  });

  it("asks for type stripping on Node 22.6+", () => {
    const resolved = resolveHookCommand("/hooks/after.ts", NODE_22_6);
    expect(resolved.args).toEqual([
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "--experimental-strip-types",
      "/hooks/after.ts",
    ]);
  });

  it("rejects TypeScript hooks on runtimes without type stripping", () => {
    expect(() => resolveHookCommand("/hooks/after.ts", NODE_22_5)).toThrow(
      CliUsageError,
    );
  });

  it("executes other files directly", () => {
    const resolved = resolveHookCommand("/hooks/after.sh", NODE_24);
    expect(resolved).toEqual({
      command: "/hooks/after.sh",
      args: [],
      display: "/hooks/after.sh",
    });
  });

  it("requires an absolute path", () => {
    const logger = createLogger();
    expect(
      () =>
        new OnChangeHook({
          spec: "relative.mjs",
          cwd: tempDir,
          logger,
          timeoutMs: 0,
        }),
    ).toThrow(CliUsageError);
  });
});

describe("OnChangeHook", () => {
  it("passes the event on stdin and in the environment", async () => {
    const output = path.join(tempDir, "captured.json");
    const script = writeScript(
      "hook.mjs",
      `import fs from "node:fs";
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
fs.writeFileSync(process.argv[2] ?? process.env.HOOK_OUT, JSON.stringify({
  payload: JSON.parse(Buffer.concat(chunks).toString("utf8")),
  event: process.env.SYNCH_EVENT,
  vault: process.env.SYNCH_VAULT,
  api: process.env.SYNCH_API_URL,
  files: process.env.SYNCH_CHANGED_FILES,
  cwd: process.cwd(),
}));
`,
    );

    const logger = createLogger();
    const hook = new OnChangeHook({
      spec: script,
      cwd: tempDir,
      logger,
      timeoutMs: 5_000,
      env: { ...process.env, HOOK_OUT: output },
      execPath: process.execPath,
      nodeVersion: process.version.replace(/^v/, ""),
      typescriptSupport: "strip",
    });

    await hook.run({
      event: "vault.changed",
      vault: tempDir,
      apiBaseUrl: "https://synch.example.com",
      detectedAt: "2026-01-01T00:00:00.000Z",
      changes: [
        { path: "notes/a.md", kind: "created" },
        { path: "notes/b.md", kind: "deleted" },
      ],
    });

    expect(logger.errors).toEqual([]);
    const captured = JSON.parse(fs.readFileSync(output, "utf8"));
    expect(captured.event).toBe("vault.changed");
    expect(captured.vault).toBe(tempDir);
    expect(captured.api).toBe("https://synch.example.com");
    expect(captured.files).toBe("notes/a.md\nnotes/b.md");
    expect(captured.cwd).toBe(tempDir);
    expect(captured.payload.changes).toEqual([
      { path: "notes/a.md", kind: "created" },
      { path: "notes/b.md", kind: "deleted" },
    ]);
  });

  it("reports a non-zero exit without failing the watch loop", async () => {
    const script = writeScript("failing.mjs", "process.exit(3);\n");
    const logger = createLogger();
    const hook = new OnChangeHook({
      spec: script,
      cwd: tempDir,
      logger,
      timeoutMs: 5_000,
      execPath: process.execPath,
      nodeVersion: process.version.replace(/^v/, ""),
      typescriptSupport: "strip",
    });

    await expect(
      hook.run({
        event: "vault.changed",
        vault: tempDir,
        apiBaseUrl: "http://127.0.0.1:8787",
        detectedAt: "2026-01-01T00:00:00.000Z",
        changes: [{ path: "a.md", kind: "modified" }],
      }),
    ).resolves.toBeUndefined();
    expect(logger.errors.join("\n")).toContain("code 3");
  });

  it("kills a script that exceeds its timeout", async () => {
    const script = writeScript("slow.mjs", "setTimeout(() => {}, 60_000);\n");
    const logger = createLogger();
    const hook = new OnChangeHook({
      spec: script,
      cwd: tempDir,
      logger,
      timeoutMs: 200,
      execPath: process.execPath,
      nodeVersion: process.version.replace(/^v/, ""),
      typescriptSupport: "strip",
    });

    await hook.run({
      event: "vault.changed",
      vault: tempDir,
      apiBaseUrl: "http://127.0.0.1:8787",
      detectedAt: "2026-01-01T00:00:00.000Z",
      changes: [{ path: "a.md", kind: "modified" }],
    });
    expect(logger.errors.join("\n")).toContain("timed out after 200ms");
  });

  it("runs a TypeScript hook on this runtime", async () => {
    const output = path.join(tempDir, "typed.json");
    const script = writeScript(
      "hook.ts",
      `import fs from "node:fs";
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { changes: { path: string }[] };
fs.writeFileSync(process.env.HOOK_OUT as string, payload.changes.map((change) => change.path).join(","));
`,
    );

    const logger = createLogger();
    const hook = new OnChangeHook({
      spec: script,
      cwd: tempDir,
      logger,
      timeoutMs: 5_000,
      env: { ...process.env, HOOK_OUT: output },
      execPath: process.execPath,
      nodeVersion: process.version.replace(/^v/, ""),
      typescriptSupport: (process.features as { typescript?: string }).typescript,
    });

    await hook.run({
      event: "vault.changed",
      vault: tempDir,
      apiBaseUrl: "http://127.0.0.1:8787",
      detectedAt: "2026-01-01T00:00:00.000Z",
      changes: [{ path: "typed.md", kind: "created" }],
    });

    expect(logger.errors).toEqual([]);
    expect(fs.readFileSync(output, "utf8")).toBe("typed.md");
  });
});
