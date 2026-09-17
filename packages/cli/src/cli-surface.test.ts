import { describe, expect, it, vi } from "vitest";
import { createCli } from "./cli.js";

describe("canonical CLI surface", () => {
  it("offers daemon host selection as a global option", () => {
    expect(createCli().helpInformation()).toContain("--host <host>");
  });

  it("shows project, workspace, and heartbeat commands while hiding worktree compatibility", () => {
    const cli = createCli();
    const help = cli.helpInformation();
    expect(help).not.toContain("bridge");
    expect(help).not.toContain("companion");
    expect(help).toContain("project");
    expect(help).toContain("workspace");
    expect(help).toContain("heartbeat");
    expect(help).not.toContain("worktree");
  });

  it("offers identical top-level and daemon config reload commands", () => {
    const cli = createCli();
    const reload = cli.commands.find((command) => command.name() === "reload");
    const daemon = cli.commands.find((command) => command.name() === "daemon");
    const nestedReload = daemon?.commands.find((command) => command.name() === "reload");

    expect(reload?.helpInformation()).toContain("--host <host>");
    expect(reload?.helpInformation()).toContain("--json");
    expect(nestedReload?.helpInformation()).toContain("--host <host>");
    expect(nestedReload?.helpInformation()).toContain("--json");
  });

  it("names explicit workspace creation without exposing older syntax", () => {
    const run = createCli().commands.find((command) => command.name() === "run");
    const help = run?.helpInformation();
    expect(help).toContain("--new-workspace <local|worktree>");
    expect(help).not.toContain("--isolation");
    expect(help).not.toContain("--worktree <name>");
  });

  it("offers the worktree creation options on run", () => {
    const run = createCli().commands.find((command) => command.name() === "run");
    const help = run?.helpInformation();
    expect(help).toContain("--worktree-mode <mode>");
    expect(help).toContain("--worktree-slug <slug>");
    expect(help).toContain("--new-branch <name>");
    expect(help).toContain("--branch <name>");
    expect(help).toContain("--pr-number <n>");
    expect(help).toContain("--forge <forge>");
  });

  it("uses background for execution and reserves detach for ownership", () => {
    const run = createCli().commands.find((command) => command.name() === "run");
    expect(run?.helpInformation()).toContain("--background");
    expect(run?.helpInformation()).not.toContain("--detach");
  });

  it("offers thinking configuration when running, updating, and scheduling agents", () => {
    const cli = createCli();
    const run = cli.commands.find((command) => command.name() === "run");
    const agent = cli.commands.find((command) => command.name() === "agent");
    const update = agent?.commands.find((command) => command.name() === "update");
    const schedule = cli.commands.find((command) => command.name() === "schedule");
    const scheduleCreate = schedule?.commands.find((command) => command.name() === "create");

    expect(run?.helpInformation()).toContain("--thinking <id>");
    expect(update?.helpInformation()).toContain("--thinking <id>");
    expect(scheduleCreate?.helpInformation()).toContain("--thinking <id>");
  });

  it("offers opening an existing agent in the desktop app", () => {
    const agent = createCli().commands.find((command) => command.name() === "agent");
    const open = agent?.commands.find((command) => command.name() === "open");

    expect(open?.helpInformation()).toContain("<agent-id>");
    expect(open?.helpInformation()).toContain("--server <server-id>");
  });

  it("offers the complete local plugin lifecycle", () => {
    const plugin = createCli().commands.find((command) => command.name() === "plugin");

    expect(plugin?.commands.map((command) => command.name())).toEqual([
      "init",
      "ls",
      "status",
      "logs",
      "install",
      "update",
      "reload",
      "enable",
      "disable",
      "remove",
    ]);
    expect(
      plugin?.commands.find((command) => command.name() === "init")?.helpInformation(),
    ).toContain("--id <id>");
    expect(
      plugin?.commands.find((command) => command.name() === "install")?.helpInformation(),
    ).toContain("--id <id>");
  });
});

describe("task verification", () => {
  it("reports failed and timed out verification without turning them into success", async () => {
    const { verifyTask: verify } = await import("@getpaseo/server");
    const cwd = process.cwd();
    expect(
      await verify({
        command: process.execPath,
        args: ["-e", "process.exit(2)"],
        cwd,
        timeoutMs: 1000,
      }),
    ).toMatchObject({ status: "failed", exitCode: 2 });
    expect(
      await verify({
        command: process.execPath,
        args: ["-e", "setTimeout(()=>{},10000)"],
        cwd,
        timeoutMs: 50,
      }),
    ).toMatchObject({ status: "timeout" });
  });
});

it("runs profile tasks as native subagents with idempotent submission and bounded recoverable results", async () => {
  const { createTestPaseoDaemon } =
    await import("../../server/src/server/test-utils/paseo-daemon.js");
  const { connectToDaemon } = await import("./utils/client.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const daemon = await createTestPaseoDaemon({
    mcpEnabled: true,
    agentProfiles: [
      {
        id: "review",
        name: "Review",
        provider: "claude",
        model: "claude-test-model",
        modeId: "default",
      },
    ],
  });
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await mkdir(join(daemon.paseoHome, "native-tasks"), { recursive: true });
  await writeFile(
    join(daemon.paseoHome, "native-tasks", "verifiers.json"),
    JSON.stringify({
      review: {
        command: process.execPath,
        args: ["-e", "console.log('verified')"],
        cwd: daemon.paseoHome,
        timeoutMs: 1000,
      },
    }),
  );
  const client = await connectToDaemon({
    target: { kind: "endpoint", host: `127.0.0.1:${daemon.port}` },
  });
  const mcp = new Client({ name: "native-task-test", version: "1" });
  try {
    const parent = await client.createAgent({
      provider: "codex",
      cwd: daemon.paseoHome,
      title: "Parent",
    });
    const token = daemon.daemon.agentManager.getMcpAuthToken();
    await mcp.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${daemon.port}/mcp/agents?callerAgentId=${parent.id}`),
        { requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {} } },
      ),
    );
    expect(
      (await mcp.listTools()).tools.find((t) => t.name === "task")?.inputSchema.properties,
    ).toHaveProperty("action");
    await writeFile(
      join(daemon.paseoHome, "reading.md"),
      "# Rules\n## Research\nRequired risk gate\n## Development\nUnrelated developer process",
    );
    const chapter = await mcp.callTool({
      name: "read_context_file",
      arguments: {
        path: "reading.md",
        section: "Research",
        resultFormat: "text",
      },
    });
    expect(chapter.isError).toBeFalsy();
    expect(chapter.structuredContent).toBeUndefined();
    expect(JSON.stringify(chapter.content)).toContain("Required risk gate");
    expect(JSON.stringify(chapter.content)).not.toContain("Unrelated developer process");

    const call = async (args: object) => {
      const r = await mcp.callTool({ name: "task", arguments: args as Record<string, unknown> });
      expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
      const block = (r.content as Array<{ type: string; text?: string }>).find(
        (c) => c.type === "text",
      );
      return JSON.parse(block!.text!);
    };
    const input = {
      action: "submit",
      taskId: "snapshot-one",
      requestId: "independent",
      role: "review",
      brief: "Return a bounded review",
    };
    const first = await call(input);
    const replay = await call(input);
    expect(replay.agentId).toBe(first.agentId);
    expect(
      (await client.fetchAgent({ agentId: first.agentId }))?.agent.labels["paseo.parent-agent-id"],
    ).toBe(parent.id);
    await vi.waitFor(
      async () => {
        const result = await call({ action: "result", taskId: input.taskId, role: input.role });
        expect(result.state).toBe("completed");
        expect(result.result).toBe("Hello world");
        expect(result.verification.status).toBe("passed");
      },
      { timeout: 10000 },
    );
    const continued = await call({
      ...input,
      action: "continue",
      requestId: "cross",
      brief: "Review the delta",
    });
    expect(continued.agentId).toBe(first.agentId);
    await vi.waitFor(
      async () => {
        expect(
          (await call({ action: "result", taskId: input.taskId, role: input.role })).state,
        ).toBe("completed");
      },
      { timeout: 10000 },
    );
  } finally {
    await mcp.close();
    await client.close();
    await daemon.close();
  }
}, 30000);
