import { test, expect } from "vitest";
import { delegationIdentity, withDelegationLock } from "./delegation-reuse.js";

test("task identity separates parents, workspaces, roles and independent runs", () => {
  const input = {
    parentId: "parent",
    workspaceId: "workspace",
    taskId: "snapshot-1",
    role: "reviewer",
    provider: "claude/sonnet",
    prompt: "independent",
  };
  const key = delegationIdentity(input);
  expect(delegationIdentity({ ...input, prompt: "cross-review" })).toBe(key);
  for (const change of [
    { parentId: "other" },
    { workspaceId: "other" },
    { role: "other" },
    { taskId: "snapshot-2" },
  ]) {
    expect(delegationIdentity({ ...input, ...change })).not.toBe(key);
  }
  expect(delegationIdentity({ ...input, taskId: undefined, prompt: "new" })).not.toBe(
    delegationIdentity({ ...input, taskId: undefined }),
  );
});

test("concurrent duplicate creation serializes lookup and survives failed creation", async () => {
  const owner = {};
  const records = new Map<string, string>();
  let creates = 0;
  const run = () =>
    withDelegationLock(owner, "key", async () => {
      if (!records.has("key")) {
        await Promise.resolve();
        creates++;
        records.set("key", "child");
      }
      return records.get("key");
    });
  expect(await Promise.all([run(), run(), run()])).toEqual(["child", "child", "child"]);
  expect(creates).toBe(1);
  await expect(
    withDelegationLock(owner, "key", async () => {
      throw new Error("fail");
    }),
  ).rejects.toThrow("fail");
  expect(await run()).toBe("child");
});
