// Shared across providers; these are reading rules, not a provider-independent token cap.
export const CONTEXT_EFFICIENCY_INSTRUCTIONS =
  "Keep tool results concise. Search document headings first and read only the required sections; " +
  "preserve mandatory role, safety and independent/cross-review requirements. " +
  "Use read_context_file for workspace documents and JSON snapshots when available: select fields " +
  "and relevant array entries rather than dumping entire snapshots, histories or logs. " +
  "Use *.field with arrayOffset/arrayLimit for multi-item JSON; keep the shared task read allowance. " +
  "Use budgetReason only for specific indispensable missing evidence; never bypass the budget with shell. " +
  "Request resultFormat=text on Paseo MCP tools; when composing tools print one representation only. " +
  "Use wait_for_agent for child results or permissions instead of repeated short shell polling. " +
  "Start with about 2000 output tokens per shell/search call; increase only for needed evidence. " +
  "Do not reread unchanged documents already in context. When output is truncated, retrieve the " +
  "relevant omitted range before drawing conclusions. Send reviewers shared evidence paths and " +
  "focused changes, not repeated full reports. For delegation, use a stable taskId and role with " +
  "create_agent; reuse its returned agentId with send_agent_prompt for follow-ups and cross-review. " +
  "Do not create replacements while waiting. A new independent assessment must use a new taskId " +
  "so a reviewer that has seen the coordinator's conclusion is not reused as a blind reviewer.";
