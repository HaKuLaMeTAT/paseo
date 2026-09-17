import { verify, VerificationSchema, VerificationResultSchema } from "./task-verification.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AgentManagerEvent } from "./agent-manager.js";
import type { PaseoToolHostDependencies } from "./tools/paseo-tools.js";
import type { PaseoToolCatalog } from "./tools/types.js";
import { withDelegationLock } from "./delegation-reuse.js";
import { deferAgentNotification } from "./deferred-notifications.js";
import { formatSystemNotificationPrompt, sendPromptToAgent } from "./agent-prompt.js";

const identity = { taskId: z.string().min(1).max(128), role: z.string().min(1).max(128) };
export const NativeTaskInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }),
  z.object({ action: z.enum(["status", "result", "cancel"]), ...identity }),
  z.object({
    action: z.enum(["submit", "continue"]),
    ...identity,
    requestId: z.string().min(1).max(128),
    brief: z.string().min(1).max(8000),
  }),
]);
const Turn = z.object({
  requestId: z.string(),
  messageId: z.string().uuid().default(randomUUID),
  brief: z.string(),
  prompt: z.string(),
  state: z.enum(["prepared", "running", "completed", "failed", "cancelled", "needs_review"]),
  turnId: z.string().nullable().default(null),
  result: z.string().nullable().default(null),
  delivered: z.boolean().default(false),
  verification: VerificationResultSchema.optional(),
  usage: z.unknown().optional(),
});
const Record = z.object({
  key: z.string(),
  parentId: z.string(),
  taskId: z.string(),
  role: z.string(),
  agentId: z.string().nullable(),
  profileSpec: z.string().optional(),
  verifier: VerificationSchema.optional(),
  turns: z.array(Turn),
  createdAt: z.string(),
});
type TaskRecord = z.infer<typeof Record>;
const LABEL = "paseo.native-task";
const services = new WeakMap<object, NativeTasks>();

export function nativeTasks(options: PaseoToolHostDependencies): NativeTasks {
  let service = services.get(options.agentManager);
  if (!service) {
    service = new NativeTasks(options);
    services.set(options.agentManager, service);
  }
  return service;
}

class NativeTasks {
  private readonly directory: string;
  constructor(private readonly options: PaseoToolHostDependencies) {
    if (!options.paseoHome) throw new Error("Native tasks require the daemon data directory");
    this.directory = join(options.paseoHome, "native-tasks");
    options.agentManager.subscribe(
      (event) => {
        if (
          event.type !== "agent_stream" ||
          !["turn_completed", "turn_failed", "turn_canceled"].includes(event.event.type)
        )
          return;
        const key = options.agentManager.getAgent(event.agentId)?.labels?.[LABEL];
        if (key)
          void this.lock(key, () => this.finish(key, event)).catch((err: unknown) =>
            options.logger.error({ err }, "Native task completion could not be persisted"),
          );
      },
      { replayState: false },
    );
  }
  private lock<T>(key: string, run: () => Promise<T>) {
    return withDelegationLock(this.options.agentManager, `native-task:${key}`, run);
  }
  private async read(key: string): Promise<TaskRecord | null> {
    try {
      return Record.parse(JSON.parse(await readFile(join(this.directory, `${key}.json`), "utf8")));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }
  private async save(record: TaskRecord) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = join(this.directory, `${record.key}.json`);
    const temp = `${target}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(record), { mode: 0o600, flag: "wx" });
    await rename(temp, target);
  }
  private view(record: TaskRecord, includeResult = false) {
    const turn = record.turns.at(-1)!;
    return {
      taskId: record.taskId,
      role: record.role,
      agentId: record.agentId,
      requestId: turn.requestId,
      state: turn.state,
      turnId: turn.turnId,
      result: includeResult ? turn.result?.slice(0, 4000) : undefined,
      resultTruncated: Boolean(turn.result && turn.result.length > 4000),
      resultDelivered: turn.delivered,
      usage: turn.usage ?? null,
      verification: turn.verification ?? { status: "not_configured" },
      usageScope: "provider_terminal_event_not_billing_total",
      guidance:
        "Managed as a native subagent. Completion is saved by the daemon and delivered when the parent is idle. Do not poll or create a replacement. Use result to explicitly recover a report.",
    };
  }
  async execute(parentId: string, raw: unknown, catalog: PaseoToolCatalog): Promise<unknown> {
    const input = NativeTaskInput.parse(raw);
    if (input.action === "list") {
      const files = await readdir(this.directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      const records = await Promise.all(
        files.filter((f) => /^[a-f0-9]{64}\.json$/.test(f)).map((f) => this.read(f.slice(0, -5))),
      );
      return records
        .filter((r): r is TaskRecord => r?.parentId === parentId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 30)
        .map((r) => this.view(r));
    }
    const key = createHash("sha256")
      .update(JSON.stringify([parentId, input.taskId, input.role]))
      .digest("hex");
    return this.lock(key, async () => {
      let record = await this.read(key);
      if (record) await this.recoverAgentId(record);
      if (input.action === "submit" || input.action === "continue") {
        if (!record) {
          if (input.action !== "submit") throw new Error("Task not found");
          record = {
            key,
            parentId,
            taskId: input.taskId,
            role: input.role,
            agentId: null,
            turns: [],
            createdAt: new Date().toISOString(),
          };
        }
        const old = record.turns.find((t) => t.requestId === input.requestId);
        if (old) {
          if (old.brief !== input.brief)
            throw new Error("requestId already used with a different brief");
          // Unknown dispatch outcomes never authorize another model run.
          if (old.state === "prepared") {
            old.state = "needs_review";
            await this.save(record);
          }
          return this.view(record);
        }
        if (
          record.turns.length &&
          (input.action === "submit" ||
            !["completed", "failed", "cancelled"].includes(record.turns.at(-1)!.state))
        )
          throw new Error(
            "Use continue on a finished task; review uncertain dispatches in the subagent first",
          );
        return this.dispatch(record, input, catalog);
      }
      if (!record) throw new Error("Task not found");
      const turn = record.turns.at(-1)!;
      if (input.action === "cancel") {
        if (record.agentId) {
          await this.assertOwnership(record);
          await catalog.executeTool("cancel_agent", { agentId: record.agentId });
        }
        turn.state = "cancelled";
      }
      if (input.action === "result") turn.delivered ||= turn.result !== null;
      if (input.action === "status") this.refreshUncertainState(record);
      await this.save(record);
      return this.view(record, input.action === "result");
    });
  }
  private async recoverAgentId(record: TaskRecord) {
    if (record.agentId) return;
    const matches = (await this.options.agentStorage.list()).filter(
      (a) =>
        a.labels?.[LABEL] === record.key && a.labels?.["paseo.parent-agent-id"] === record.parentId,
    );
    if (matches.length > 1) throw new Error("Ambiguous task ownership; inspect the subagents");
    if (matches[0]) {
      record.agentId = matches[0].id;
      await this.save(record);
    }
  }
  private refreshUncertainState(record: TaskRecord) {
    const turn = record.turns.at(-1)!;
    if (!["prepared", "running"].includes(turn.state) || !record.agentId) return;
    const agent = this.options.agentManager.getAgent(record.agentId);
    if (!agent || ["idle", "closed", "error"].includes(agent.lifecycle))
      turn.state = "needs_review";
  }
  private async assertOwnership(record: TaskRecord) {
    const agent = record.agentId ? await this.options.agentStorage.get(record.agentId) : null;
    if (
      !agent ||
      agent.archivedAt ||
      agent.labels?.["paseo.parent-agent-id"] !== record.parentId ||
      agent.labels?.[LABEL] !== record.key
    )
      throw new Error(
        "Task subagent was archived, detached or changed ownership; inspect it manually",
      );
    const live = this.options.agentManager.getAgent(agent.id);
    if (live && this.options.agentManager.hasInFlightRun(agent.id)) {
      const rows = await this.options.agentManager.getTimelineRows(agent.id);
      const latest = rows.findLast((row) => row.item.type === "user_message");
      if (
        !latest ||
        latest.item.type !== "user_message" ||
        latest.item.clientMessageId !== record.turns.at(-1)!.messageId
      )
        throw new Error("Another message owns this subagent; refusing to interrupt it");
    }
  }
  private async configureVerifier(record: TaskRecord) {
    if (!record.turns.length) {
      try {
        const configured = z
          .record(z.string(), VerificationSchema)
          .parse(JSON.parse(await readFile(join(this.directory, "verifiers.json"), "utf8")));
        record.verifier = configured[record.role];
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
    }
  }
  private async resolveProfile(record: TaskRecord) {
    const profiles = this.options.daemonConfigStore?.get().agentProfiles;
    const profile = profiles?.find((p) => p.id === record.role);
    if (!profile?.model)
      throw new Error(
        "Select an existing profile with an explicit model; no fallback provider is chosen",
      );
    const spec = JSON.stringify(profile);
    if (record.profileSpec && record.profileSpec !== spec)
      throw new Error(
        "Profile changed; start a new task instead of changing an existing worker silently",
      );
    record.profileSpec = spec;
    const parent = this.options.agentManager.getAgent(record.parentId);
    if (!parent) throw new Error("Parent session is unavailable");
    const provider = await this.options.providerSnapshotManager.getProvider({
      provider: profile.provider,
      cwd: parent.cwd,
      wait: true,
    });
    if (!provider.enabled || provider.status !== "ready")
      throw new Error("Configured provider is unavailable; no fallback selected");
    const modeId = profile.modeId ?? provider.modes?.find((mode) => mode.id === "default")?.id;
    if (!modeId && profile.provider !== parent.provider)
      throw new Error("Cross-provider task needs an explicit profile mode");
    return { profile, modeId };
  }
  private async dispatch(
    record: TaskRecord,
    input: { requestId: string; brief: string },
    catalog: PaseoToolCatalog,
  ) {
    const { profile, modeId } = await this.resolveProfile(record);
    if (record.agentId) {
      await this.assertOwnership(record);
      if (this.options.agentManager.hasInFlightRun(record.agentId))
        throw new Error("Subagent is busy");
    }
    await this.configureVerifier(record);
    const prompt = [
      record.turns.length
        ? ""
        : `Effective profile ${profile.id}: model=${profile.model}; thinking=${profile.thinkingOptionId ?? "default"}. Structured settings override historical notes.\n${profile.notes ?? ""}`,
      input.brief,
      "Read only relevant contract ranges and focused evidence. Do not forward full history. Return one final report within 3000 characters with artifacts, verification and unresolved issues. Preserve the established independent/cross-review workflow. No further delegation unless authorized by that workflow.",
    ]
      .filter(Boolean)
      .join("\n\n");
    record.turns.push(
      Turn.parse({ requestId: input.requestId, brief: input.brief, prompt, state: "prepared" }),
    );
    await this.save(record);
    if (record.agentId) {
      await catalog.executeTool("send_agent_prompt", {
        agentId: record.agentId,
        prompt,
        messageId: record.turns.at(-1)!.messageId,
        background: true,
        notifyOnFinish: false,
      });
    } else {
      const reply = await catalog.executeTool("create_agent", {
        title: `${record.role} · ${record.taskId}`.slice(0, 60),
        provider: `${profile.provider}/${profile.model}`,
        taskId: record.taskId,
        role: record.role,
        initialPrompt: prompt,
        messageId: record.turns.at(-1)!.messageId,
        notifyOnFinish: false,
        labels: { [LABEL]: record.key },
        settings: {
          modeId,
          thinkingOptionId: profile.thinkingOptionId,
          features: profile.featureValues,
        },
      });
      const created = z.object({ agentId: z.string() }).parse(reply.structuredContent);
      const child = this.options.agentManager.getAgent(created.agentId);
      if (child?.labels?.[LABEL] !== record.key)
        throw new Error(
          "This identity belongs to a legacy subagent; inspect it instead of adopting an unrelated result",
        );
      record.agentId = created.agentId;
    }
    record.turns.at(-1)!.state = "running";
    await this.save(record);
    return this.view(record);
  }
  private async finish(key: string, event: Extract<AgentManagerEvent, { type: "agent_stream" }>) {
    const record = await this.read(key);
    if (!record || !("turnId" in event.event) || !event.event.turnId) return;
    const turn = record.turns.at(-1)!;
    if (!["prepared", "running"].includes(turn.state)) return;
    const rows = await this.options.agentManager.getTimelineRows(event.agentId);
    const user = rows.findLast((row) => row.item.type === "user_message");
    if (
      !user ||
      user.turnId !== event.event.turnId ||
      user.item.type !== "user_message" ||
      user.item.clientMessageId !== turn.messageId
    ) {
      turn.state = "needs_review";
    } else {
      turn.turnId = event.event.turnId;
      turn.state = "failed";
      if (event.event.type === "turn_completed") turn.state = "completed";
      if (event.event.type === "turn_canceled") turn.state = "cancelled";
      const answer = rows.findLast(
        (row) => row.turnId === turn.turnId && row.item.type === "assistant_message",
      );
      if (turn.state === "completed") {
        if (answer?.item.type === "assistant_message") turn.result = answer.item.text;
        else turn.state = "needs_review";
      }
      if (event.event.type === "turn_completed") turn.usage = event.event.usage;
    }
    record.agentId = event.agentId;
    if (turn.state === "completed" && record.verifier) {
      turn.verification = { status: "interrupted", exitCode: null, outputTail: "" };
      await this.save(record);
      turn.verification = await verify(record.verifier);
    }
    await this.save(record);
    this.notify(record);
  }
  private notify(record: TaskRecord) {
    const { agentManager, agentStorage, logger } = this.options;
    deferAgentNotification({
      manager: agentManager,
      parentId: record.parentId,
      key: `task:${record.key}`,
      build: async () => {
        const latest = await this.read(record.key);
        if (
          !latest ||
          latest.turns.at(-1)!.delivered ||
          latest.turns.at(-1)!.requestId !== record.turns.at(-1)!.requestId
        )
          return null;
        const parent = await agentStorage.get(record.parentId);
        const child = record.agentId ? await agentStorage.get(record.agentId) : null;
        if (parent?.archivedAt || child?.labels?.["paseo.parent-agent-id"] !== record.parentId)
          return null;
        return `Task ${latest.taskId} (${latest.role}) is ${latest.turns.at(-1)!.state}. Use task action=result with these IDs once to retrieve the report. Do not repeat the research.`;
      },
      deliver: async (body) => {
        await sendPromptToAgent({
          agentManager,
          agentStorage,
          agentId: record.parentId,
          prompt: formatSystemNotificationPrompt(body),
          replaceRunning: false,
          unarchive: false,
          logger,
        });
      },
      onError: (err) =>
        logger.error({ err }, "Native task notification failed; result remains recoverable"),
    });
  }
}
