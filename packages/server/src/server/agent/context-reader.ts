import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

export interface ContextReadInput {
  path: string;
  fields?: string[];
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
    text: JSON.stringify(projected, null, 2),
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
  for (let parent = root; ; parent = path.dirname(parent)) {
    if (["AGENTS.md", "CLAUDE.md"].some((name) => path.join(parent, name) === file)) return true;
    if (parent === path.dirname(parent)) return false;
  }
}

function selectContext(source: string, file: string, input: ContextReadInput) {
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
    start,
    lineLimit,
    offset,
    requestedBudget,
    arrayOffset,
    arrayLimit,
  ]);
  return { selected, key, offset, requestedBudget, nextArrayOffset, nextLine };
}

export const CONTEXT_TASK_CHAR_BUDGET = 48000;

export class ContextReader {
  private readonly seen = new Map<string, string>();
  private taskId: string | undefined;
  private remainingChars = CONTEXT_TASK_CHAR_BUDGET;
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
    const unchanged = !input.force && this.seen.get(key) === hash;
    if (!unchanged && this.remainingChars === 0 && !input.budgetReason?.trim()) {
      return {
        path: relative,
        budgetExceeded: true,
        remainingChars: 0,
        text: "Task read budget reached. Summarize existing evidence. For indispensable missing evidence, request a focused range with budgetReason; do not dump the file through shell.",
        truncated: true,
        nextOffset: offset,
      };
    }
    const budget = Math.min(requestedBudget, this.remainingChars || requestedBudget);
    const text = unchanged
      ? "Already read; selected content is unchanged. Use force only if it is no longer in context."
      : selected.slice(offset, offset + budget);
    if (!unchanged) this.remainingChars = Math.max(0, this.remainingChars - text.length);
    // A reduced task allowance must not mark an unserved tail as already read.
    if (unchanged || budget === requestedBudget || offset + budget >= selected.length) {
      this.seen.delete(key);
      this.seen.set(key, hash);
    }
    if (this.seen.size > 128) this.seen.delete(this.seen.keys().next().value!);
    const truncated = offset + budget < selected.length;
    return {
      path: relative,
      unchanged,
      hash,
      text,
      remainingChars: this.remainingChars,
      ...(input.budgetReason ? { budgetReason: input.budgetReason } : {}),
      ...(nextArrayOffset !== undefined ? { nextArrayOffset } : {}),
      truncated,
      ...(truncated ? { nextOffset: offset + budget } : {}),
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
