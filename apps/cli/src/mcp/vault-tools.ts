import fs from "node:fs/promises";
import path from "node:path";

import type { CliAppContext } from "../app/context";

const MAX_NOTE_BYTES = 2 * 1024 * 1024;
const MAX_RESULTS = 100;

export interface VaultNote { path: string; size: number; modifiedAt: string }
export interface SearchMatch { path: string; line: number; text: string }

export class VaultNotes {
  constructor(private readonly ctx: CliAppContext) {}

  async list(): Promise<VaultNote[]> {
    const notes: VaultNote[] = [];
    for (const file of await this.ctx.vaultAdapter.listFiles()) {
      if (!file.path.toLowerCase().endsWith(".md")) continue;
      const stat = await this.ctx.vaultAdapter.statFile(file.path);
      if (stat) notes.push({ path: file.path, size: stat.size, modifiedAt: new Date(stat.mtime).toISOString() });
    }
    return notes.sort((a, b) => a.path.localeCompare(b.path));
  }

  async read(notePath: string): Promise<string> {
    const safePath = await this.validatePath(notePath, true);
    const stat = await this.ctx.vaultAdapter.statFile(safePath);
    if (!stat) throw new Error(`Note not found: ${safePath}`);
    if (stat.size > MAX_NOTE_BYTES) throw new Error(`Note is larger than ${MAX_NOTE_BYTES} bytes: ${safePath}`);
    return new TextDecoder("utf-8", { fatal: true }).decode(await this.ctx.vaultAdapter.readBytes(safePath));
  }

  async search(query: string): Promise<SearchMatch[]> {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) throw new Error("Search query must not be empty.");
    const matches: SearchMatch[] = [];
    for (const note of await this.list()) {
      if (note.size > MAX_NOTE_BYTES) continue;
      for (const [index, line] of (await this.read(note.path)).split(/\r?\n/).entries()) {
        if (line.toLocaleLowerCase().includes(needle)) {
          matches.push({ path: note.path, line: index + 1, text: line });
          if (matches.length === MAX_RESULTS) return matches;
        }
      }
    }
    return matches;
  }

  async write(notePath: string, content: string, overwrite: boolean): Promise<void> {
    const safePath = await this.validatePath(notePath, false);
    if (Buffer.byteLength(content) > MAX_NOTE_BYTES) throw new Error(`Note content exceeds ${MAX_NOTE_BYTES} bytes.`);
    if (!overwrite && await this.ctx.vaultAdapter.exists(safePath)) throw new Error(`Note already exists: ${safePath}`);
    const parent = path.posix.dirname(safePath);
    if (parent !== ".") await this.ctx.vaultAdapter.mkdir(parent);
    await this.ctx.vaultAdapter.writeText(safePath, content);
  }

  private async validatePath(notePath: string, mustExist: boolean): Promise<string> {
    const normalized = notePath.trim().replaceAll("\\", "/").replace(/^\.\//, "");
    if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => !part || part === "." || part === "..") || !normalized.toLowerCase().endsWith(".md") || !this.ctx.vaultAdapter.isSyncablePath(normalized) || this.ctx.vaultAdapter.isProtectedVaultPath(normalized)) {
      throw new Error(`Unsafe or non-syncable Markdown path: ${notePath}`);
    }
    const absolute = path.join(this.ctx.vaultPath, ...normalized.split("/"));
    const relative = path.relative(this.ctx.vaultPath, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Path escapes the vault: ${notePath}`);

    let current = this.ctx.vaultPath;
    for (const segment of normalized.split("/")) {
      current = path.join(current, segment);
      try {
        if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Symbolic links are not allowed in note paths: ${notePath}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
        throw error;
      }
    }
    if (mustExist && !await this.ctx.vaultAdapter.exists(normalized)) throw new Error(`Note not found: ${normalized}`);
    return normalized;
  }
}
