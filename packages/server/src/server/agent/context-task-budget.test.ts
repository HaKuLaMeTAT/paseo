import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { AgentManager } from "./agent-manager.js";
import { getContextReader } from "./context-reader.js";
import { formatSystemNotificationPrompt } from "./agent-prompt.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { createTestLogger } from "../../test-utils/test-logger.js";

test.each(["codex", "claude", "opencode"])(
  "%s: system callbacks retain the read allowance; a user turn renews it",
  async (provider) => {
    const dir = await mkdtemp(join(tmpdir(), "paseo-task-budget-"));
    const manager = new AgentManager({
      clients: createTestAgentClients(),
      logger: createTestLogger(),
    });
    const agent = await manager.createAgent({ provider, cwd: dir }, undefined, {
      workspaceId: "wks_budget",
    });
    try {
      await writeFile(join(dir, "evidence.md"), "x".repeat(9000));
      await manager.runAgent(agent.id, "hello", { clientMessageId: "user-1" });
      const reader = getContextReader(manager, agent.id);
      const input = { path: "evidence.md", maxChars: 8000, force: true };
      expect((await reader.read(dir, input)).remainingChars).toBe(40000);
      await manager.runAgent(agent.id, formatSystemNotificationPrompt("child finished"), {
        clientMessageId: "callback-1",
      });
      expect((await reader.read(dir, input)).remainingChars).toBe(32000);
      await manager.runAgent(agent.id, "hello again", { clientMessageId: "user-2" });
      expect((await reader.read(dir, input)).remainingChars).toBe(40000);
    } finally {
      await manager.closeAgent(agent.id);
      await rm(dir, { recursive: true, force: true });
    }
  },
);
