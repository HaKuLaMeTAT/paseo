import type { AgentManager } from "./agent-manager.js";

interface PendingNotification {
  key: string;
  build: () => Promise<string | null>;
}
interface DeliveryQueue {
  items: Map<string, PendingNotification>;
  scheduled: boolean;
  flushing: boolean;
  unsubscribe: () => void;
  schedule: () => void;
}
const queues = new WeakMap<object, Map<string, DeliveryQueue>>();

// System callbacks must never replace an active user turn. Providers need not support steering.
export function deferAgentNotification(input: {
  manager: AgentManager;
  parentId: string;
  key: string;
  build: () => Promise<string | null>;
  deliver: (body: string) => Promise<unknown>;
  onError: (error: unknown) => void;
}): void {
  const { manager, parentId } = input;
  const parents = queues.get(manager) ?? new Map<string, DeliveryQueue>();
  queues.set(manager, parents);
  let queue = parents.get(parentId);
  if (queue) {
    queue.items.set(input.key, input);
    queue.schedule();
    return;
  }
  queue = {
    items: new Map([[input.key, input]]),
    scheduled: false,
    flushing: false,
    unsubscribe: () => {},
    schedule: () => {},
  };
  parents.set(parentId, queue);
  const current = queue;
  const dispose = () => {
    current.unsubscribe();
    if (parents.get(parentId) === current) parents.delete(parentId);
  };
  const busy = () => {
    const agent = manager.getAgent(parentId);
    return (
      agent?.lifecycle === "running" ||
      Boolean(agent?.activeForegroundTurnId) ||
      manager.hasInFlightRun(parentId)
    );
  };
  const flush = async () => {
    current.scheduled = false;
    if (parents.get(parentId) !== current || current.flushing || busy()) return;
    const parent = manager.getAgent(parentId);
    if (!parent || parent.lifecycle === "closed") {
      dispose();
      return;
    }
    current.flushing = true;
    const batch = [...current.items.values()];
    try {
      const bodies = await Promise.all(batch.map((item) => item.build()));
      if (parents.get(parentId) !== current) return;
      const latest = manager.getAgent(parentId);
      if (!latest || latest.lifecycle === "closed") {
        dispose();
        return;
      }
      if (busy()) return;
      const body = bodies.filter((value): value is string => value !== null).join("\n\n");
      if (body) await input.deliver(body);
      for (const item of batch)
        if (current.items.get(item.key) === item) current.items.delete(item.key);
      if (current.items.size === 0) dispose();
    } catch (error) {
      // A user turn may win the race after the idle check; leave notifications queued.
      if (!busy()) {
        input.onError(error);
        dispose();
      }
    } finally {
      current.flushing = false;
      if (parents.get(parentId) === current && current.items.size && !busy()) schedule();
    }
  };
  const schedule = () => {
    if (!current.scheduled) {
      current.scheduled = true;
      // State events can precede foreground-run settlement in the same tick.
      setTimeout(() => {
        void flush();
      }, 0);
    }
  };
  current.schedule = schedule;
  current.unsubscribe = manager.subscribe(
    (event) => {
      if (event.type === "agent_state" && event.agent.lifecycle === "closed") {
        dispose();
        return;
      }
      schedule();
    },
    { agentId: parentId, replayState: false },
  );
  schedule();
}
