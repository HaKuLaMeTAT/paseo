import { useMemo } from "react";
import type { ToolCallDetailProjection } from "@/tool-calls/detail-level/projection";
import type { StreamItem } from "@/types/stream";

export interface CompletedProcessGroup {
  id: string;
  count: number;
}

/** Hide completed response activity without dropping its final answer or stored history. */
export function collapseCompletedProcesses(
  items: StreamItem[],
  isTurnActive: boolean,
  expanded: ReadonlySet<string>,
) {
  const groups = new Map<string, CompletedProcessGroup>();
  const hidden = new Set<string>();
  let start = 0;
  function finish(end: number, active: boolean) {
    if (active) return;
    const response = items.slice(start, end);
    let finalIndex = -1;
    for (let i = response.length - 1; i >= 0; i--) {
      if (response[i]?.kind === "assistant_message") {
        finalIndex = i;
        break;
      }
    }
    if (finalIndex < 0) return;
    const final = response[finalIndex]!;
    if (final.kind !== "assistant_message") return;
    const finalGroup = final.blockGroupId ?? final.id;
    const process = response
      .slice(0, finalIndex)
      .filter(
        (item) =>
          item.kind === "thought" ||
          item.kind === "tool_call" ||
          item.kind === "todo_list" ||
          (item.kind === "assistant_message" && (item.blockGroupId ?? item.id) !== finalGroup),
      );
    if (!process.length) return;
    const host = process[0]!;
    groups.set(host.id, { id: host.id, count: process.length });
    if (!expanded.has(host.id)) for (const item of process.slice(1)) hidden.add(item.id);
  }
  for (let i = 0; i < items.length; i++) {
    if (items[i]?.kind === "user_message") {
      finish(i, false);
      start = i;
    }
  }
  finish(items.length, isTurnActive);
  return { items: hidden.size ? items.filter((item) => !hidden.has(item.id)) : items, groups };
}

export function useCompletedProcessPresentation(
  source: ToolCallDetailProjection,
  isTurnActive: boolean,
  expanded: ReadonlySet<string>,
) {
  const completedHead = isTurnActive ? EMPTY_HEAD : source.head;
  const completed = useMemo(
    () =>
      collapseCompletedProcesses(
        completedHead.length ? [...source.tail, ...completedHead] : source.tail,
        isTurnActive,
        expanded,
      ),
    [source.tail, completedHead, isTurnActive, expanded],
  );
  const presentation = useMemo(
    () => ({ ...source, tail: completed.items, head: isTurnActive ? source.head : EMPTY_HEAD }),
    [source, completed, isTurnActive],
  );
  return { presentation, groups: completed.groups };
}
const EMPTY_HEAD: StreamItem[] = [];
