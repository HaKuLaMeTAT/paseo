import { mkdtemp, writeFile, symlink, rm, mkdir } from "node:fs/promises";
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
    expect(first.nextRead).toMatchObject({ path: "doc.md", maxLines: 2, offset: 5 });
    expect((await reader.read(dir, { ...first.nextRead!, maxChars: 10 })).text).toBe("\nsecond");
    await symlink("/etc/hosts", join(dir, "escape"));
    await expect(reader.read(dir, { path: "escape" })).rejects.toThrow(
      "inside the current workspace",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("requires justified continuation after the review threshold without replaying partial reads", async () => {
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
    expect(justified.text).toHaveLength(6000);
    expect(justified.skippedChars).toBe(2000);
    expect(justified.totalReadChars).toBe(54000);
    expect(
      await reader.read(dir, {
        path: "large.md",
        offset: 54000,
        budgetReason:
          "Read the final mandatory evidence omitted from the previous bounded selection",
      }),
    ).toMatchObject({ totalReadChars: 58000, budgetWarning: true });
    const repeated = await reader.read(dir, { path: "large.md", offset: 46000, maxChars: 8000 });
    expect(repeated).toMatchObject({ unchanged: true, totalReadChars: 58000 });
    reader.beginTask("user-2");
    expect((await reader.read(dir, { path: "large.md", offset: 58000 })).remainingChars).toBe(
      46000,
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

test("allows repository ancestor contracts while blocking escaped docs and unrelated files", async () => {
  const root = await mkdtemp(join(tmpdir(), "paseo-contracts-"));
  try {
    const cwd = join(root, "project", "worker");
    await mkdir(cwd, { recursive: true });
    await mkdir(join(root, ".git"));
    await mkdir(join(root, "project", "docs"));
    await writeFile(join(root, "project", "docs", "workflow.md"), "required contract");
    await writeFile(join(root, "private.md"), "not approved");
    const reader = new ContextReader([]);
    expect((await reader.read(cwd, { path: "../docs/workflow.md" })).text).toBe(
      "required contract",
    );
    await expect(reader.read(cwd, { path: "../../private.md" })).rejects.toThrow(
      "inside the current workspace",
    );
    await symlink("/etc/hosts", join(root, "project", "docs", "escape.md"));
    await expect(reader.read(cwd, { path: "../docs/escape.md" })).rejects.toThrow(
      "inside the current workspace",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("selects Markdown chapters without loading adjacent routes and preserves selection through pagination", async () => {
  const dir = await mkdtemp(join(tmpdir(), "paseo-chapters-"));
  try {
    await writeFile(
      join(dir, "routes.md"),
      [
        "# Routes",
        "## Intraday",
        "first",
        "```sh",
        "# fake heading",
        "```",
        "### Risk",
        "mandatory gate",
        "## After close",
        "unrelated news route",
        "## Duplicate",
        "one",
        "## Duplicate",
        "two",
      ].join("\n"),
    );
    const reader = new ContextReader();
    const outline = await reader.read(dir, { path: "routes.md", outline: true });
    expect(outline.text).toContain("2-8\t## Intraday");
    expect(outline.text).not.toContain("fake heading");
    expect(outline.text).not.toContain("mandatory gate");
    const first = await reader.read(dir, { path: "routes.md", section: "Intraday", maxChars: 20 });
    const second = await reader.read(dir, { ...first.nextRead!, maxChars: 8000 });
    expect(first.nextRead).toMatchObject({ section: "Intraday", offset: 20 });
    expect(first.text + second.text).toContain("mandatory gate");
    expect(first.text + second.text).not.toContain("unrelated news route");
    expect(
      (await reader.read(dir, { path: "routes.md", section: "Intraday", maxChars: 8000 }))
        .unchanged,
    ).toBe(true);
    await expect(reader.read(dir, { path: "routes.md", section: "Duplicate" })).rejects.toThrow(
      "found 2",
    );
    await expect(reader.read(dir, { path: "routes.md", section: "Missing" })).rejects.toThrow(
      "found 0",
    );
    await expect(
      reader.read(dir, { path: "routes.md", section: "Intraday", outline: true }),
    ).rejects.toThrow("cannot be combined");
    await writeFile(join(dir, "data.json"), "{}");
    await expect(reader.read(dir, { path: "data.json", outline: true })).rejects.toThrow(
      "requires Markdown",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
