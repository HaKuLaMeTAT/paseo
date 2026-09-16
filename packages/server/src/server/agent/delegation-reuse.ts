import { createHash } from "node:crypto";

export const DELEGATION_KEY = "paseo.delegation-key";
export const DELEGATION_SPEC = "paseo.delegation-spec";

export function delegationIdentity(input: {
  parentId: string;
  workspaceId: string;
  taskId?: string;
  role?: string;
  provider: string;
  prompt: string;
}): string {
  // Legacy callers deduplicate identical requests only: do not guess task identity from titles.
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.parentId,
        input.workspaceId,
        input.taskId ? { taskId: input.taskId } : { prompt: input.prompt.trim() },
        input.role ?? input.provider.split("/")[0],
      ]),
    )
    .digest("hex");
}

const queues = new WeakMap<object, Map<string, Promise<void>>>();

// Shared across MCP connections, with persistent labels used for lookup after a restart.
export async function withDelegationLock<T>(
  owner: object,
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  let locks = queues.get(owner);
  if (!locks) {
    locks = new Map();
    queues.set(owner, locks);
  }
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => next);
  locks.set(key, tail);
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (locks.get(key) === tail) locks.delete(key);
  }
}
