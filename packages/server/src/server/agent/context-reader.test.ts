import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { ContextReader } from "./context-reader.js";

test("projects snapshot entries, skips unchanged selections, detects changes and allows rereads", async () => {
  const dir = await mkdtemp(join(tmpdir(), "paseo-context-"));
  try {
    const reader = new ContextReader();
    const file = join(dir, "snapshot.json");
    await writeFile(
      file,
      JSON.stringify({ positions: [{ symbol: "A", price: 10 }], history: "unused".repeat(10000) }),
    );
    const input = { path: "snapshot.json", fields: ["positions.0.price"] };
    const first = await reader.read(dir, input);
    expect(first.text).toContain("10");
    expect(first.text).not.toContain("unused");
    expect((await reader.read(dir, input)).unchanged).toBe(true);
    expect((await reader.read(dir, { ...input, force: true })).unchanged).toBe(false);
    await writeFile(file, JSON.stringify({ positions: [{ price: 11 }] }));
    expect((await reader.read(dir, input)).text).toContain("11");
    await expect(reader.read(dir, { path: "snapshot.json" })).rejects.toThrow("require fields");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bounds document ranges and paginates without allowing workspace escape", async () => {
  const dir = await mkdtemp(join(tmpdir(), "paseo-context-"));
  try {
    await writeFile(join(dir, "doc.md"), "first\nsecond\nthird");
    const reader = new ContextReader();
    const first = await reader.read(dir, { path: "doc.md", maxLines: 2, maxChars: 5 });
    expect(first).toMatchObject({ text: "first", truncated: true, nextOffset: 5, nextLine: 3 });
    expect((await reader.read(dir, { path: "doc.md", maxLines: 2, offset: 5 })).text).toBe(
      "\nsecond",
    );
    await symlink("/etc/hosts", join(dir, "escape"));
    await expect(reader.read(dir, { path: "escape" })).rejects.toThrow(
      "inside the current workspace",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
