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

test("shares task allowance across concurrent files, preserves partial tails and resets only for a new task", async () => {
  const dir = await mkdtemp(join(tmpdir(), "paseo-budget-"));
  try {
    await writeFile(join(dir, "large.md"), "x".repeat(60000));
    const reader = new ContextReader();
    reader.beginTask("user-1");
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        reader.read(dir, { path: "large.md", offset: i * 8000, maxChars: 8000 }),
      ),
    );
    const prefix = await reader.read(dir, { path: "large.md", offset: 40000, maxChars: 6000 });
    expect(prefix.remainingChars).toBe(2000);
    const partial = await reader.read(dir, { path: "large.md", offset: 46000, maxChars: 8000 });
    expect(partial).toMatchObject({ remainingChars: 0, nextOffset: 48000 });
    expect(partial.text).toHaveLength(2000);
    reader.beginTask("user-1");
    expect(
      await reader.read(dir, { path: "large.md", offset: 46000, maxChars: 8000 }),
    ).toMatchObject({ budgetExceeded: true });
    const justified = await reader.read(dir, {
      path: "large.md",
      offset: 46000,
      maxChars: 8000,
      budgetReason: "Need the omitted evidence before making the final decision",
    });
    expect(justified.unchanged).toBe(false);
    expect(justified.text).toHaveLength(8000);
    reader.beginTask("user-2");
    expect((await reader.read(dir, { path: "large.md", offset: 54000 })).remainingChars).toBe(
      44000,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("projects and pages only requested array fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "paseo-project-"));
  try {
    await writeFile(
      join(dir, "snapshot.json"),
      JSON.stringify({
        items: [{ symbol: "A", secret: "omit" }, { symbol: "B", secret: "omit" }, { symbol: "C" }],
      }),
    );
    const reader = new ContextReader();
    const input = { path: "snapshot.json", fields: ["items.*.symbol"], arrayLimit: 2 };
    const page = await reader.read(dir, input);
    expect(JSON.parse(page.text)).toEqual({ "items.*.symbol": ["A", "B"] });
    expect(page.nextArrayOffset).toBe(2);
    expect(JSON.parse((await reader.read(dir, { ...input, arrayOffset: 2 })).text)).toEqual({
      "items.*.symbol": ["C"],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("allows configured skill Markdown but rejects unrelated files and escaped symlinks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "paseo-workspace-"));
  const skills = await mkdtemp(join(tmpdir(), "paseo-skills-"));
  try {
    await writeFile(join(skills, "SKILL.md"), "mandatory review rule");
    await writeFile(join(skills, "config.json"), "{}");
    const reader = new ContextReader([skills]);
    expect((await reader.read(dir, { path: join(skills, "SKILL.md") })).text).toBe(
      "mandatory review rule",
    );
    await expect(
      reader.read(dir, { path: join(skills, "config.json"), fields: ["x"] }),
    ).rejects.toThrow("inside the current workspace");
    await symlink("/etc/hosts", join(skills, "escape.md"));
    await expect(reader.read(dir, { path: join(skills, "escape.md") })).rejects.toThrow(
      "inside the current workspace",
    );
  } finally {
    await Promise.all([
      rm(dir, { recursive: true, force: true }),
      rm(skills, { recursive: true, force: true }),
    ]);
  }
});
