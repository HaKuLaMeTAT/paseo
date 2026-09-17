// Shared across providers; these are reading rules, not a provider-independent token cap.
export const CONTEXT_EFFICIENCY_INSTRUCTIONS =
  "Keep tool results concise. Use section for exact Markdown chapter titles, or outline=true to discover them without reading body text; " +
  "preserve mandatory role, safety and independent/cross-review requirements. " +
  "Use read_context_file for workspace documents and JSON snapshots when available: select fields " +
  "and relevant array entries rather than dumping entire snapshots, histories or logs. " +
  "Use *.field with arrayOffset/arrayLimit for multi-item JSON. At the shared read review threshold, " +
  "provide budgetReason for specific missing mandatory evidence and continue bounded reads. Never restart the task or open a new session solely to reset the threshold; do not bypass it with shell. " +
  "Request resultFormat=text on Paseo MCP tools; when composing tools print one representation only. " +
  "When native task is available, submit/continue it and end the parent turn; the daemon notifies on completion. Use result once, not repeated wait/status polling. " +
  "Start with about 2000 output tokens per shell/search call; increase only for needed evidence. " +
  "Reuse complete current rules already supplied in startup context or read in this session; do not force-read them for confirmation. When output is truncated, retrieve the " +
  "relevant omitted range using nextRead verbatim (retain maxLines and selection fields) before drawing conclusions. Send reviewers shared evidence paths and " +
  "focused changes, not repeated full reports. For delegation, use a stable taskId and role with " +
  "the native task interface. Only on older hosts without task use create_agent and reuse its agentId with send_agent_prompt. " +
  "Do not create replacements while waiting. A new independent assessment must use a new taskId " +
  "so a reviewer that has seen the coordinator's conclusion is not reused as a blind reviewer.";
