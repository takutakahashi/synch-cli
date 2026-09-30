import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CliAppContext } from "../app/context";
import { VaultNotes } from "./vault-tools";

const tempDirs: string[] = [];
afterEach(async () => { await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))); });

async function createNotes() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "synch-mcp-"));
  tempDirs.push(root);
  const ctx = new CliAppContext({ vaultPath: root, apiBaseUrl: "http://127.0.0.1:8787", credentialsPath: path.join(root, "credentials.json") });
  return { root, ctx, notes: new VaultNotes(ctx) };
}

describe("VaultNotes", () => {
  it("creates, lists, reads, and searches Markdown notes", async () => {
    const { ctx, notes } = await createNotes();
    await notes.write("projects/plan.md", "# Launch\nShip on Friday", false);
    expect(await notes.list()).toEqual([expect.objectContaining({ path: "projects/plan.md", size: 23 })]);
    expect(await notes.read("projects/plan.md")).toBe("# Launch\nShip on Friday");
    expect(await notes.search("FRIDAY")).toEqual([{ path: "projects/plan.md", line: 2, text: "Ship on Friday" }]);
    await ctx.close();
  });

  it("requires explicit overwrite", async () => {
    const { ctx, notes } = await createNotes();
    await notes.write("note.md", "one", false);
    await expect(notes.write("note.md", "two", false)).rejects.toThrow(/already exists/);
    await notes.write("note.md", "two", true);
    expect(await notes.read("note.md")).toBe("two");
    await ctx.close();
  });

  it("rejects traversal, reserved paths, non-Markdown files, and symlinks", async () => {
    const { root, ctx, notes } = await createNotes();
    await fs.mkdir(path.join(root, "outside"));
    await fs.symlink(path.join(root, "outside"), path.join(root, "linked"));
    await expect(notes.write("../escape.md", "x", false)).rejects.toThrow(/Unsafe/);
    await expect(notes.write(".synch/private.md", "x", false)).rejects.toThrow(/Unsafe/);
    await expect(notes.write("note.txt", "x", false)).rejects.toThrow(/Unsafe/);
    await expect(notes.write("linked/escape.md", "x", false)).rejects.toThrow(/Symbolic links/);
    await ctx.close();
  });
});
