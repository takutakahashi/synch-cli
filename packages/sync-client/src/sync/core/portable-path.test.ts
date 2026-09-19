import { describe, expect, it } from "vitest";

import { validatePortableVaultPath } from "./portable-path";

describe("validatePortableVaultPath", () => {
  it.each([
    "Notes/2026-09-13.md",
    "日本語/😀.md",
    ".obsidian/plugins/example/data.json",
  ])("accepts a portable path: %s", (path) => {
    expect(validatePortableVaultPath(path)).toEqual([]);
  });

  it.each([
    ["Notes/a:b.md", "windows_reserved_character"],
    ["Notes/a\\b.md", "windows_reserved_character"],
    ["Notes/a\u0001b.md", "windows_control_character"],
    ["Notes/note.md ", "windows_trailing_space_or_dot"],
    ["Notes/NUL.md", "windows_reserved_name"],
    ["COM¹", "windows_reserved_name"],
    ["Notes/CONIN$", "windows_reserved_name"],
    ["Notes/CONOUT$.log", "windows_reserved_name"],
    ["Notes//file.md", "empty_component"],
    ["Notes/../file.md", "dot_component"],
  ])("rejects %s", (path, code) => {
    expect(validatePortableVaultPath(path).map((violation) => violation.code)).toContain(code);
  });
});
