import { isPendingSessionId } from "@occ/core";
import type { ReasoningEffort, SandboxMode } from "@occ/core";

export const DEFAULT_SANDBOX: SandboxMode = "workspace-write";

export interface AgyHeadlessArgOptions {
  cwd: string;
  brief: string;
  sandbox: SandboxMode;
  model?: string;
  effort?: ReasoningEffort;
  resumeSessionId?: string;
  timeoutMs: number;
}

export function printTimeoutFlag(timeoutMs: number): string {
  return `${Math.max(1, Math.ceil(timeoutMs / 1000))}s`;
}

export function agyEffort(effort?: ReasoningEffort): "low" | "medium" | "high" | undefined {
  if (!effort) return undefined;
  if (effort === "xhigh" || effort === "max") return "high";
  return effort;
}

export function buildHeadlessArgs(opts: AgyHeadlessArgOptions): string[] {
  // No --cwd: agy 1.1.15 has no such flag. Spawn cwd is the workspace.
  const args = [
    "-p",
    opts.brief,
    "--output-format",
    "json",
    "--print-timeout",
    printTimeoutFlag(opts.timeoutMs),
  ];
  if (opts.sandbox === "read-only") {
    args.push("--mode", "plan");
  } else {
    args.push("--mode", "accept-edits");
  }
  if (opts.sandbox === "danger-full-access") {
    args.push("--dangerously-skip-permissions");
  }
  if (opts.model?.trim()) {
    args.push("--model", opts.model.trim());
  }
  const effort = agyEffort(opts.effort);
  if (effort) {
    args.push("--effort", effort);
  }
  if (opts.resumeSessionId && !isPendingSessionId(opts.resumeSessionId)) {
    args.push("--conversation", opts.resumeSessionId);
  }
  return args;
}

export function resolveAgyBin(): string {
  // Never `gemini` — that is Google's older Gemini CLI, not Antigravity.
  return process.env.AGY_BIN?.trim() || "agy";
}
