import { afterEach, expect, test, vi } from "vitest";
import { AgentManager, type AgentManagerEvent, type ManagedAgent } from "./agent-manager.js";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { deferAgentNotification } from "./deferred-notifications.js";

afterEach(() => vi.useRealTimers());

function fixture() {
  vi.useFakeTimers();
  const manager = new AgentManager({ clients: {}, logger: createTestLogger() });
  const agent: ManagedAgent = Object.create(null);
  agent.id = "parent";
  agent.lifecycle = "running";
  let tracked = false;
  const listeners = new Set<(event: AgentManagerEvent) => void>();
  vi.spyOn(manager, "getAgent").mockReturnValue(agent);
  vi.spyOn(manager, "hasInFlightRun").mockImplementation(() => tracked);
  vi.spyOn(manager, "subscribe").mockImplementation((callback) => {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  });
  const deliver = vi.fn().mockResolvedValue(undefined);
  const onError = vi.fn();
  return {
    agent,
    deliver,
    onError,
    listeners,
    tracked(value: boolean) {
      tracked = value;
    },
    emit() {
      for (const callback of listeners) callback({ type: "agent_state", agent });
    },
    add(key: string, build: () => Promise<string | null>) {
      deferAgentNotification({ manager, parentId: "parent", key, build, deliver, onError });
    },
  };
}

test("does not deliver until foreground and tracked runs settle, then batches and deduplicates", async () => {
  const f = fixture();
  f.add("child-1", async () => "old");
  f.add("child-1", async () => "latest");
  f.add("child-2", async () => "second");
  await vi.runAllTimersAsync();
  expect(f.deliver).not.toHaveBeenCalled();
  f.agent.lifecycle = "idle";
  f.tracked(true);
  f.emit();
  await vi.runAllTimersAsync();
  expect(f.deliver).not.toHaveBeenCalled();
  f.tracked(false);
  f.emit();
  await vi.runAllTimersAsync();
  expect(f.deliver).toHaveBeenCalledExactlyOnceWith("latest\n\nsecond");
  expect(f.listeners.size).toBe(0);
});

test("discards resolved permission notices and notices for closed parents", async () => {
  const f = fixture();
  f.add("permission", async () => null);
  f.agent.lifecycle = "idle";
  f.emit();
  await vi.runAllTimersAsync();
  expect(f.deliver).not.toHaveBeenCalled();
  expect(f.listeners.size).toBe(0);
  f.add("finished", async () => "finished");
  f.agent.lifecycle = "closed";
  f.emit();
  await vi.runAllTimersAsync();
  expect(f.deliver).not.toHaveBeenCalled();
  expect(f.listeners.size).toBe(0);
});

test("keeps notifications when a new user turn wins the delivery race", async () => {
  const f = fixture();
  f.agent.lifecycle = "idle";
  f.deliver.mockImplementationOnce(async () => {
    f.agent.lifecycle = "running";
    throw new Error("active run");
  });
  f.add("finished", async () => "finished");
  await vi.runAllTimersAsync();
  expect(f.deliver).toHaveBeenCalledTimes(1);
  expect(f.onError).not.toHaveBeenCalled();
  f.agent.lifecycle = "idle";
  f.emit();
  await vi.runAllTimersAsync();
  expect(f.deliver).toHaveBeenCalledTimes(2);
  expect(f.listeners.size).toBe(0);
});

test("does not strand a notification enqueued while building a stale batch", async () => {
  const f = fixture();
  f.agent.lifecycle = "idle";
  f.add("stale", async () => {
    f.add("new", async () => "new evidence");
    return null;
  });
  await vi.runAllTimersAsync();
  expect(f.deliver).toHaveBeenCalledExactlyOnceWith("new evidence");
  expect(f.listeners.size).toBe(0);
});
