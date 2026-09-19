import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CliUsageError } from "./context";
import {
  DEFAULT_ON_CHANGE_TIMEOUT_MS,
  parseCliArgs,
  resolveApiBaseUrlOrUsageError,
  resolveCommand,
  resolveOnChangeOptions,
} from "./cli-args";

describe("resolveCommand", () => {
  it("maps each top-level command", () => {
    expect(resolveCommand(["login"])).toBe("login");
    expect(resolveCommand(["logout"])).toBe("logout");
    expect(resolveCommand(["pull"])).toBe("pull");
    expect(resolveCommand(["sync"])).toBe("sync");
    expect(resolveCommand(["watch"])).toBe("watch");
    expect(resolveCommand(["status"])).toBe("status");
  });

  it("maps vault subcommands", () => {
    expect(resolveCommand(["vault", "list"])).toBe("vault-list");
    expect(resolveCommand(["vault", "create"])).toBe("vault-create");
    expect(resolveCommand(["vault", "connect"])).toBe("vault-connect");
    expect(resolveCommand(["vault", "disconnect"])).toBe("vault-disconnect");
  });

  it("rejects unknown or incomplete commands", () => {
    expect(resolveCommand(["vault"])).toBeNull();
    expect(resolveCommand(["vault", "delete"])).toBeNull();
    expect(resolveCommand(["vault", "list", "extra"])).toBeNull();
    expect(resolveCommand(["status", "extra"])).toBeNull();
    expect(resolveCommand([])).toBeNull();
  });
});

describe("parseCliArgs", () => {
  it("parses flags and positionals", () => {
    const { values, positionals } = parseCliArgs([
      "vault",
      "create",
      "--name",
      "notes",
      "--vault",
      "/tmp/notes",
      "--json",
    ]);

    expect(positionals).toEqual(["vault", "create"]);
    expect(values.name).toBe("notes");
    expect(values.vault).toBe("/tmp/notes");
    expect(values.json).toBe(true);
  });

  it("turns unknown flags into usage errors", () => {
    expect(() => parseCliArgs(["sync", "--nope"])).toThrow(CliUsageError);
  });

  it("turns a malformed --api-url into a usage error", () => {
    expect(() => resolveApiBaseUrlOrUsageError("ftp://nope")).toThrow(
      CliUsageError,
    );
    expect(resolveApiBaseUrlOrUsageError("https://synch.example.com")).toBe(
      "https://synch.example.com",
    );
  });
});

describe("resolveOnChangeOptions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synch-on-change-"));
  const script = path.join(dir, "hook.mjs");
  fs.writeFileSync(script, "process.exit(0);\n");

  it("is optional", () => {
    expect(resolveOnChangeOptions("watch", {})).toBeNull();
  });

  it("is only supported by watch", () => {
    expect(() =>
      resolveOnChangeOptions("sync", { "on-change": script }),
    ).toThrow(CliUsageError);
  });

  it("requires an existing script file", () => {
    expect(() =>
      resolveOnChangeOptions("watch", { "on-change": path.join(dir, "missing.mjs") }),
    ).toThrow(/not found/);
  });

  it("resolves the script and applies the default timeout", () => {
    expect(resolveOnChangeOptions("watch", { "on-change": script })).toEqual({
      spec: script,
      timeoutMs: DEFAULT_ON_CHANGE_TIMEOUT_MS,
    });
  });

  it("parses a custom timeout, including zero", () => {
    expect(
      resolveOnChangeOptions("watch", {
        "on-change": script,
        "on-change-timeout": "0",
      }),
    ).toEqual({ spec: script, timeoutMs: 0 });
    expect(
      resolveOnChangeOptions("watch", {
        "on-change": script,
        "on-change-timeout": "1500",
      }),
    ).toEqual({ spec: script, timeoutMs: 1500 });
  });

  it("rejects an invalid timeout and a timeout without a hook", () => {
    expect(() =>
      resolveOnChangeOptions("watch", {
        "on-change": script,
        "on-change-timeout": "-1",
      }),
    ).toThrow(/non-negative integer/);
    expect(() =>
      resolveOnChangeOptions("watch", { "on-change-timeout": "100" }),
    ).toThrow(/requires --on-change/);
  });
});
