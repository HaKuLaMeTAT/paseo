import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { selectMarkdown } from "./markdown-sections.js";

export interface ContextReadInput {
  path: string;
  fields?: string[];
  section?: string;
  outline?: boolean;
  startLine?: number;
  maxLines?: number;
  offset?: number;
  maxChars?: number;
  force?: boolean;
  arrayOffset?: number;
  arrayLimit?: number;
  budgetReason?: string;
}

function projectJsonFields(source: string, fields: string[], offset: number, limit: number) {
  const data: unknown = JSON.parse(source);
  let more = false;
  function select(value: unknown, keys: string[]): unknown {
    if (keys.length === 0) return value;
    const [key, ...rest] = keys;
    if (key === "*" && Array.isArray(value)) {
      more ||= offset + limit < value.length;
      return value.slice(offset, offset + limit).map((entry) => select(entry, rest));
    }
    if (!value || typeof value !== "object" || !Object.hasOwn(value, key!))
      return { missing: true };
    return select((value as Record<string, unknown>)[key!], rest);
  }
  const projected: Record<string, unknown> = Object.create(null);
  for (const field of fields) projected[field] = select(data, field.split("."));
  return {
    text: JSON.stringify(projected),
    nextArrayOffset: more ? offset + limit : undefined,
  };
}

function containsPath(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function allowedDocument(root: string, file: string, skillRoots: string[]): Promise<boolean> {
  if (containsPath(root, file)) return true;
  if (path.extname(file).toLowerCase() !== ".md") return false;
  for (const skillRoot of skillRoots) {
    const resolved = await realpath(skillRoot).catch(() => null);
    if (resolved && containsPath(resolved, file)) return true;
  }
  // Only repository-owned Markdown contracts may be read above a sub-workspace.
  // Resolve both roots and targets so an approved directory cannot escape by symlink.
  let repository: string | null = null;
  for (let parent = root; ; parent = path.dirname(parent)) {
    if (
      await stat(path.join(parent, ".git")).then(
        () => true,
        () => false,
      )
    ) {
      repository = parent;
      break;
    }
    if (parent === path.dirname(parent)) break;
  }
  if (repository) {
    for (let parent = root; containsPath(repository, parent); parent = path.dirname(parent)) {
      for (const name of ["docs", ".agents/skills"]) {
        const approved = await realpath(path.join(parent, name)).catch(() => null);
        if (approved && containsPath(repository, approved) && containsPath(approved, file))
          return true;
      }
      if (parent === repository) break;
    }
  }
  for (let parent = root; ; parent = path.dirname(parent)) {
    if (["AGENTS.md", "CLAUDE.md"].some((name) => path.join(parent, name) === file)) return true;
    if (parent === path.dirname(parent)) return false;
  }
}

function selectContext(source: string, file: string, input: ContextReadInput) {
  if (input.section || input.outline) {
    if (
      path.extname(file).toLowerCase() !== ".md" ||
      input.fields ||
      (input.section && input.outline)
    ) {
      throw new Error(
        "section/outline requires Markdown and cannot be combined with JSON fields or each other.",
      );
    }
    source = selectMarkdown(source, input.section, input.outline);
  }
  const start = Math.max(1, input.startLine ?? 1);
  const lineLimit = Math.max(1, Math.min(200, input.maxLines ?? 80));
  const offset = Math.max(0, input.offset ?? 0);
  const requestedBudget = Math.max(1, Math.min(8000, input.maxChars ?? 4000));
  const arrayOffset = Math.max(0, input.arrayOffset ?? 0);
  const arrayLimit = Math.max(1, Math.min(50, input.arrayLimit ?? 15));
  let nextArrayOffset: number | undefined;
  let selected: string;
  let nextLine: number | undefined;
  if (input.fields?.length) {
    const projection = projectJsonFields(source, input.fields, arrayOffset, arrayLimit);
    selected = projection.text;
    nextArrayOffset = projection.nextArrayOffset;
  } else {
    if (path.extname(file).toLowerCase() === ".json") {
      throw new Error(
        "JSON snapshots require fields (dot paths, with numeric array indexes or * and arrayOffset/arrayLimit) to avoid dumping the whole snapshot.",
      );
    }
    const lines = source.split("\n");
    selected = lines.slice(start - 1, start - 1 + lineLimit).join("\n");
    if (start - 1 + lineLimit < lines.length) nextLine = start + lineLimit;
  }
  const key = JSON.stringify([
    file,
    input.fields,
    input.section,
    input.outline,
    start,
    lineLimit,
    arrayOffset,
    arrayLimit,
  ]);
  return { selected, key, offset, requestedBudget, nextArrayOffset, nextLine };
}

export const CONTEXT_TASK_CHAR_BUDGET = 48000;
// A review threshold, not the model context window. Required evidence can continue
// in bounded reads with an explicit reason; no forced fresh-session replay.
function unreadRange(ranges: Array<[number, number]>, start: number, end: number) {
  for (const [from, to] of ranges) {
    if (to <= start) continue;
    if (from > start) return [start, Math.min(from, end)] as const;
    start = Math.max(start, to);
    if (start >= end) break;
  }
  return [Math.min(start, end), end] as const;
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const merged: Array<[number, number]> = [];
  for (const range of ranges.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

export class ContextReader {
  private readonly seen = new Map<string, { hash: string; ranges: Array<[number, number]> }>();
  private taskId: string | undefined;
  private remainingChars = CONTEXT_TASK_CHAR_BUDGET;
  private totalReadChars = 0;
  constructor(
    private readonly skillRoots = [
      path.join(homedir(), ".codex/skills"),
      path.join(homedir(), ".agents/skills"),
    ],
  ) {}

  beginTask(taskId: string): void {
    if (taskId === this.taskId) return;
    this.taskId = taskId;
    this.remainingChars = CONTEXT_TASK_CHAR_BUDGET;
    this.totalReadChars = 0;
  }

  async read(cwd: string, input: ContextReadInput) {
    const root = await realpath(cwd);
    const file = await realpath(path.resolve(root, input.path));
    const relative = path.relative(root, file);
    if (!(await allowedDocument(root, file, this.skillRoots))) {
      throw new Error(
        "Context reads must stay inside the current workspace or approved Markdown skill/ancestor instruction locations, including symlink targets.",
      );
    }
    const metadata = await stat(file);
    if (!metadata.isFile() || metadata.size > 16 * 1024 * 1024) {
      throw new Error("Expected a file no larger than 16 MiB; extract a focused snapshot first.");
    }
    const source = await readFile(file, "utf8");
    const { selected, key, offset, requestedBudget, nextArrayOffset, nextLine } = selectContext(
      source,
      file,
      input,
    );
    const hash = createHash("sha256").update(selected).digest("hex");
    const served = this.seen.get(key);
    const ranges = served?.hash === hash ? served.ranges : [];
    const requestedEnd = Math.min(selected.length, offset + requestedBudget);
    const [from, end] = input.force
      ? [Math.min(offset, requestedEnd), requestedEnd]
      : unreadRange(ranges, offset, requestedEnd);
    const unchanged = from === end;
    const needsReason = !unchanged && this.remainingChars === 0 && !input.budgetReason?.trim();
    const resume = (nextOffset: number) => ({
      ...input,
      // Pin defaults: an offset is relative to this exact line/field selection.
      startLine: input.startLine ?? 1,
      maxLines: input.maxLines ?? 80,
      offset: nextOffset,
    });
    if (needsReason) {
      return {
        path: relative,
        budgetExceeded: true,
        requiresBudgetReason: true,
        remainingChars: 0,
        totalReadChars: this.totalReadChars,
        text: "Context read review threshold reached, not a model context limit. Reuse existing evidence; for a missing mandatory section, retry nextRead with a specific budgetReason and bounded fields/range. Do not restart the task, open a new session, or bypass through shell merely to reset the allowance.",
        truncated: true,
        nextOffset: from,
        nextRead: resume(from),
      };
    }
    const budget = this.remainingChars > 0 ? this.remainingChars : requestedBudget;
    const to = Math.min(end, from + budget);
    const text = unchanged
      ? "Already read; selected content is unchanged. Use force only if it is no longer in context."
      : selected.slice(from, to);
    if (!unchanged) {
      this.totalReadChars += text.length;
      this.remainingChars = Math.max(0, this.remainingChars - text.length);
      this.seen.set(key, { hash, ranges: mergeRanges([...ranges, [from, to]]) });
    }
    if (this.seen.size > 128) this.seen.delete(this.seen.keys().next().value!);
    const truncated = to < selected.length;
    return {
      path: relative,
      unchanged,
      hash,
      text,
      skippedChars: Math.max(0, from - offset),
      totalReadChars: this.totalReadChars,
      remainingChars: this.remainingChars,
      budgetWarning: this.remainingChars === 0,
      ...(input.budgetReason ? { budgetReason: input.budgetReason } : {}),
      ...(nextArrayOffset !== undefined ? { nextArrayOffset } : {}),
      truncated,
      ...(truncated ? { nextOffset: to, nextRead: resume(to) } : {}),
      ...(nextLine !== undefined ? { nextLine } : {}),
    };
  }
}

const readers = new WeakMap<object, Map<string, ContextReader>>();
export function getContextReader(owner: object, agentId: string): ContextReader {
  let byAgent = readers.get(owner);
  if (!byAgent) {
    byAgent = new Map();
    readers.set(owner, byAgent);
  }
  let reader = byAgent.get(agentId);
  if (!reader) {
    reader = new ContextReader();
    byAgent.set(agentId, reader);
    if (byAgent.size > 256) byAgent.delete(byAgent.keys().next().value!);
  }
  return reader;
}
