import { spawn } from "node:child_process";
import treeKill from "tree-kill";
import { z } from "zod";

export const VerificationSchema = z.object({
  label: z.string().max(160).optional(),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().min(1),
  timeoutMs: z.number().int().min(1).max(30000).default(30000),
});
export const VerificationResultSchema = z.object({
  status: z.enum(["passed", "failed", "timeout", "not_configured", "interrupted"]),
  exitCode: z.number().nullable(),
  outputTail: z.string(),
});

export async function verify(
  raw: z.infer<typeof VerificationSchema>,
): Promise<z.infer<typeof VerificationResultSchema>> {
  const config = VerificationSchema.parse(raw);
  return new Promise((resolve) => {
    // Only trusted host configuration supplies executable/arguments. Task input and
    // model output are never interpolated into shell commands.
    const child = spawn(config.command, config.args, {
      cwd: config.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let outputTail = "";
    let settled = false;
    let timedOut = false;
    const finish = (status: "passed" | "failed" | "timeout", exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Both process error and close may fire; settled above makes delivery exclusive.
      // oxlint-disable-next-line promise/no-multiple-resolved
      resolve({ status, exitCode, outputTail });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid === undefined) {
        finish("timeout", null);
        return;
      }
      treeKill(child.pid, "SIGKILL", (error) => {
        if (error) outputTail = `${outputTail}\nProcess cleanup: ${error.message}`.slice(-2000);
        finish("timeout", null);
      });
    }, config.timeoutMs);
    const append = (chunk: Buffer) => {
      outputTail = (outputTail + chunk.toString("utf8")).slice(-2000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", (error) => {
      outputTail = error.message.slice(-2000);
      finish("failed", null);
    });
    child.once("close", (code) => {
      if (timedOut) return;
      finish(code === 0 ? "passed" : "failed", code);
    });
  });
}
