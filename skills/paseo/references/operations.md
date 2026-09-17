## Projects

Manage the daemon's project registry through the CLI:

```bash
paseo project create [path]
paseo project ls
paseo project rename <project-id> <name>
paseo project rename <project-id> --reset
paseo project delete <project-id>
```

For a local daemon, `project create` defaults to the current directory and resolves relative paths on the CLI machine. With `--host` or `PASEO_HOST`, always provide a path; the target daemon interprets it on its own machine. Deleting a project archives its active workspaces and removes the project from Paseo without deleting the project directory.

## Workspaces

**`create_workspace`** — create a workspace independently of any agent. Required: `isolation` (`local` or `worktree`). Worktree isolation supports `mode: "branch-off" | "checkout-branch" | "checkout-pr"`: use `branchName`/`baseBranch` for a new branch, `branch` for an existing branch, or `prNumber` plus optional `forge`/`projectPath` for a change request. `worktreeSlug` controls the managed path. Returns the workspace descriptor centered on `workspaceId`.

Choose `baseBranch` explicitly: `origin/main` selects the remote-tracking branch; `refs/heads/main` selects local main. Bare `main` prefers local main when it exists, otherwise origin/main. Paseo retains the resolved ref for workspace comparisons, even after rebasing the branch or changing its PR target.

**`list_workspaces`** — list active workspaces.

**`archive_workspace`** — `{ workspaceId }`. Archives the workspace, its agents, and its terminals. Local directories remain; Paseo removes an owned worktree only after its final active workspace reference is archived.

**`rename_workspace`** — `{ workspaceId, name }`. Rename workspace.

## Workspace scripts

Configured `paseo.json` scripts use the same supervised lifecycle from tools and the CLI.

**`list_workspace_scripts`** — `{ workspaceId }`. Lists configured scripts with lifecycle, service port, proxy URLs, health, exit code, and terminal ID.

**`start_workspace_script`** — `{ workspaceId, scriptName }`. Starts one configured script through Paseo's managed workspace-script launcher and returns its status metadata.

**`stop_workspace_script`** — `{ workspaceId, scriptName }`. Stops a running script through its supervised terminal and returns the stopped status metadata.

The matching CLI surface accepts either an explicit workspace ID or resolves the current directory:

```bash
paseo script ls [--cwd <path> | --workspace <workspace-id>]
paseo script start <name> [--cwd <path> | --workspace <workspace-id>]
paseo script stop <name> [--cwd <path> | --workspace <workspace-id>]
```

## Agents

**MCP result size:** Pass `resultFormat: "text"` to Paseo MCP calls when only model-visible output is needed. When composing tools, print either structured content or text content once; do not print both representations. Legacy clients keep the default response shape.

**`wait_for_agent`** — `{ agentId }`: wait up to 30 seconds for completion or a pending permission. Handle the actual permission under existing rules. If still running, do other work or end your turn for a deferred notification; avoid repeated short shell polls. Child notifications are delivered when the parent is idle, without replacing its active turn.

**`read_context_file`** — agent-scoped workspace reads: `{ path, section?, outline?, fields?, startLine?, maxLines?, offset?, maxChars?, force?, arrayOffset?, arrayLimit?, budgetReason? }`. For Markdown, use `section` with an exact ATX heading title or `outline=true` for heading titles and source line ranges. Fenced code headings are ignored; duplicate/missing titles require a unique section or explicit range, never a whole-file fallback. Sections include nested headings; startLine/nextLine are relative to the selected section or outline. Do not combine section/outline with JSON fields. JSON snapshots require explicit `fields` using dot paths (e.g. `positions.0.symbol`, `timestamp`). Output defaults to 4000 characters, capped at 8000 per call and a shared 48000-character review threshold per user task. System notifications do not reset the allowance. For arrays, select fields such as `positions.*.symbol` and page with `arrayOffset`/`arrayLimit`; use `nextRead` verbatim for a truncated selection, retaining line limits and field selection. After the selection is complete, use `nextLine`/`nextArrayOffset` for the next page. Beyond the review threshold, each bounded read requires `budgetReason` naming the missing mandatory evidence. This is not a model context limit or an instruction to open a fresh session. Never bypass it with shell dumps. Markdown in home skill directories, repository ancestor docs/.agents/skills and ancestor AGENTS.md/CLAUDE.md is also readable. Print the returned content text once, not the whole MCP response; keep combined output within the outer tool budget. Repeated unchanged selections return a short notice. Use `force` only when content is no longer in context (for example after compaction). Mandatory role and review rules still apply; do not fetch every linked document or dump whole snapshots by default.

**`create_agent`** — required: `title`, `provider` (`claude/opus`, `codex/gpt-5.4`, …), `initialPrompt`. Optional: `workspaceId`, `notifyOnFinish`, `settings`, `labels`, `taskId`, `role`. Returns `{ agentId, workspaceId, … }`.

Initial runtime settings live under `settings`: `modeId`, `thinkingOptionId`, and provider-specific `features`. Agent profiles are the preferred source for these values. For Codex fast mode, pass `settings: { features: { "fast_mode": true } }` when creating the agent.

Agent-scoped creation creates or returns your subagent. Use a stable `taskId` (business run/evidence snapshot) and `role` for repeated delegation. The same parent, workspace, task and role returns the existing unarchived agent with `reused: true`; the initial prompt is NOT sent again. Send follow-ups and cross-review using `send_agent_prompt` and that ID. Do not create replacement agents while waiting. A new blind independent assessment needs a new taskId because the prior reviewer has already seen the coordinator’s conclusion. Without taskId, only identical initial prompts are deduplicated; do not rely on title matching. Model/settings conflicts require explicit update or a distinct task.

Agent-scoped creation always keeps the caller as parent. Omit `workspaceId` to use your current workspace; pass a workspace returned by `create_workspace` for isolated delegation. Placement never changes parentage.

Detach is an explicit user action in the subagents track, not an agent tool. A cross-workspace child remains your subagent even though it also appears as a normal tab in its workspace.

Agent-scoped `create_agent` defaults `notifyOnFinish` to true. Set it to `false` only for truly fire-and-forget agents.

**`send_agent_prompt`** — `{ agentId, prompt }`. Use for follow-ups to an existing agent. Agent-scoped prompt calls default to `background: true` and `notifyOnFinish: true`; top-level calls default to blocking with no callback. For a synchronous follow-up, pass `background: false` and use the returned result.

**`update_agent`** — `{ agentId, name?, labels?, settings? }`. Use `settings` for runtime changes on an existing agent: `modeId`, `model`, `thinkingOptionId`, and provider-specific `features`. For Codex fast mode, pass `settings: { features: { "fast_mode": true } }`.

**`list_agents`** — filter by `cwd`, `statuses`, `sinceHours`, `includeArchived`.

**`archive_agent`** — `{ agentId }`. Interrupts if running, removes from active list.

## Agent profiles and provider discovery

**`list_profiles`** — named launch bundles configured by the human. Before choosing how to launch a delegated agent, call this tool and read every profile's `notes`. Pick a named profile the user requested, or the profile whose notes best match the work.

There is no `profile` parameter on `create_agent`. Materialize the selected profile into the call:

- combine `provider` and `model` as the `provider/model` value for `create_agent.provider`
- copy `modeId` to `settings.modeId`
- copy `thinkingOptionId` to `settings.thinkingOptionId`
- copy `featureValues` to `settings.features`

Omit absent values. Do not remember a selected profile or infer drift later; a profile is only launch configuration.

If no profile fits, or no profiles are configured, use the provider discovery tools below rather than guessing. Tell the user when you fall back because no configured profile fits.

**`list_providers`** — compact provider availability and modes.

**`list_models`** — full model list for one provider. Use only when you need model IDs or thinking options; the list can be large.

**`inspect_provider`** — compact provider capability and feature inspection. Required: `provider`; pass `cwd` when you are not in an agent-scoped session. Optional: `settings` with draft `model`, `modeId`, `thinkingOptionId`, and `features`.

Only set feature IDs returned by `inspect_provider`. For Codex fast mode, look for `fast_mode` and pass `settings: { features: { "fast_mode": true } }` to `create_agent` or `update_agent`.

## Schedules and heartbeats

**`create_schedule`** — starts a new agent on a cron cadence. Required: `prompt`, `cron`, `provider`. Optional: `timezone`, `name`, `cwd`, `maxRuns`, `expiresIn`. Use when the recurring work should live in fresh agents.

**`create_heartbeat`** — sends you a prompt on a cron cadence. Required: `prompt`, `cron`. Optional: `timezone`, `name`, `maxRuns`, `expiresIn`. Use for reminders, PR/build babysitting, and status checks that should return to this conversation.

**`delete_heartbeat`** stops it. MCP intentionally exposes no heartbeat update tool; delete and recreate when its task or cadence changes.

Schedules have the full list/inspect/update/pause/resume/run-once/log/delete surface. Heartbeats deliberately do not.

## Waiting

Agents take time — 10–30+ minutes is routine. Favor asynchronous workflows.

For agent-scoped `create_agent` and background `send_agent_prompt`, leave `notifyOnFinish` omitted or set it to `true` unless the work is truly fire-and-forget. You will get notified when the target agent finishes, errors, or needs permission. Move on to other work. The notification arrives on its own.

Don't poll `list_agents` or `get_agent_status` to "check on" a running agent. The notification will tell you.

## CLI semantics

The CLI and tools use the same ownership semantics even where their syntax differs:

```bash
paseo workspace create --isolation worktree --mode branch-off --new-branch fix-x --base origin/main
paseo workspace create --isolation worktree --mode checkout-branch --branch existing-work
paseo workspace create --isolation worktree --mode checkout-pr --pr-number 42
paseo run --provider codex/gpt-5.4 --mode full-access --workspace <workspace-id> "<prompt>"
paseo run --provider codex/gpt-5.4 --mode full-access --new-workspace worktree --worktree-mode branch-off --new-branch fix-x --base origin/main "<prompt>"
paseo send <agent-id> "<follow-up>"
paseo ls
paseo schedule create --cron "*/15 * * * *" "ping main build"
paseo heartbeat create --cron "*/15 * * * *" "check the build"
```

Discover with `paseo --help` and `paseo <cmd> --help`.

For product questions, setup, logs, version problems, or troubleshooting, use the **paseo-help** skill.
