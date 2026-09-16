import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

export interface ContextReadInput {
  path: string;
  fields?: string[];
  startLine?: number;
  maxLines?: number;
  offset?: number;
  maxChars?: number;
  force?: boolean;
}

function projectJsonFields(source: string, fields: string[]): string {
  const data: unknown = JSON.parse(source);
  const projected: Record<string, unknown> = Object.create(null);
  for (const field of fields) {
    let value: unknown = data;
    for (const key of field.split(".")) {
      if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) {
        value = undefined;
        break;
      }
      value = (value as Record<string, unknown>)[key];
    }
    projected[field] = value === undefined ? { missing: true } : value;
  }
  return JSON.stringify(projected, null, 2);
}

export class ContextReader {
  private readonly seen = new Map<string, string>();

  async read(cwd: string, input: ContextReadInput) {
    const root = await realpath(cwd);
    const file = await realpath(path.resolve(root, input.path));
    const relative = path.relative(root, file);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(
        "Context reads must stay inside the current workspace, including symlink targets.",
      );
    }
    const metadata = await stat(file);
    if (!metadata.isFile() || metadata.size > 16 * 1024 * 1024) {
      throw new Error("Expected a file no larger than 16 MiB; extract a focused snapshot first.");
    }
    const source = await readFile(file, "utf8");
    const start = Math.max(1, input.startLine ?? 1);
    const lineLimit = Math.max(1, Math.min(200, input.maxLines ?? 80));
    const offset = Math.max(0, input.offset ?? 0);
    const budget = Math.max(1, Math.min(16000, input.maxChars ?? 8000));
    let selected: string;
    let nextLine: number | undefined;
    if (input.fields?.length) {
      selected = projectJsonFields(source, input.fields);
    } else {
      if (path.extname(file).toLowerCase() === ".json") {
        throw new Error(
          "JSON snapshots require fields (dot paths, with numeric array indexes) to avoid dumping the whole snapshot.",
        );
      }
      const lines = source.split("\n");
      selected = lines.slice(start - 1, start - 1 + lineLimit).join("\n");
      if (start - 1 + lineLimit < lines.length) nextLine = start + lineLimit;
    }
    const key = JSON.stringify([file, input.fields, start, lineLimit, offset, budget]);
    const hash = createHash("sha256").update(selected).digest("hex");
    const unchanged = !input.force && this.seen.get(key) === hash;
    this.seen.delete(key);
    this.seen.set(key, hash);
    if (this.seen.size > 128) this.seen.delete(this.seen.keys().next().value!);
    const truncated = offset + budget < selected.length;
    return {
      path: relative,
      unchanged,
      hash,
      text: unchanged
        ? "Already read; selected content is unchanged. Use force only if it is no longer in context."
        : selected.slice(offset, offset + budget),
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
