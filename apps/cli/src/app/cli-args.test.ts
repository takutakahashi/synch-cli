import { describe, expect, it } from "vitest";

import { CliUsageError } from "./context";
import { parseCliArgs, resolveCommand } from "./cli-args";

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
});
