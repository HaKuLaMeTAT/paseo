---
name: paseo
description: Paseo reference for managing projects, workspaces, workspace scripts, agents, schedules, and heartbeats.
---

# Paseo

Use Paseo to run and manage authorized work on the selected host. Read only the relevant reference section for project/workspace administration, raw agent tools, schedules or troubleshooting.

## Native tasks

Use `task_roles` for the compact configured role directory; pass `role` to inspect one profile's full instructions. For authorized bounded delegation, prefer `task` over assembling raw create/send/wait calls:

- `action=submit`, `role=<actual profile ID>`, stable `taskId` and `requestId` strings, and a brief containing only goal, scope, necessary paths and acceptance. UUIDs are not required. The daemon materializes current profile settings and creates a native subagent in your workspace.
- End the parent turn after submission when no independent work remains. The daemon watches the worker, saves completion and notifies only when the parent is idle. Do not loop on wait/status or start a supervisor model.
- Use `action=result` once after the completion notice. Full process stays in the child; the result is bounded. Explicitly reading result again is recovery, not a reason to repeat it in the final answer.
- `continue` with a new requestId adds only the delta to the same task. A new independent judgment uses a fresh taskId. Exact retries preserve IDs and brief.
- `list`, `status`, `cancel` manage tasks scoped to the actual parent. Unknown dispatch/result ownership yields `needs_review`, never automatic model reruns. Inspect the native child before deciding the next operation.

Children remain visible in Paseo's subagent track and support the existing view/continue/stop/archive gestures. Human takeover or detachment is not permission for the old task to interrupt a new message. Worker completion, configured command verification and human acceptance are separate. Usage is the provider's terminal-event report, not a complete cost ledger.

For formal compass work, only Xiaoba coordinates and finalizes; one Xiaobao performs independent and cross-review turns. The entry delegates once and does not reload the worker's research contracts or evidence. Do not delegate trivial work or broaden permissions.

## Reading and other operations

For workspace/project/scripts, legacy create/send/stop, model discovery, schedules or heartbeat operations, read the relevant section of [operations](references/operations.md). Do not load the whole reference before a task submission. Query provider/model capabilities only when the selected Profile is insufficient; do not guess or switch channels.

For evidence reads use `read_context_file` with fields/ranges, returning the text content once. Its shared allowance is 48000 characters plus at most 8000 justified extension characters per task. Do not batch outputs beyond the outer tool limit or bypass exhausted allowance with shell. Preserve formal cross-review and evidence freshness rules.

On hosts without the task tool, the reference documents existing native agent operations. This is an older host, not a reason to create duplicate tasks or a model-driven polling loop. Native tasks become available after the host daemon is upgraded.
