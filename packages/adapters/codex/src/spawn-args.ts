import { isPendingSessionId } from "@occ/core";
import type { SandboxMode } from "@occ/core";

export const DEFAULT_SANDBOX: SandboxMode = "workspace-write";
export const DEFAULT_TIMEOUT_MS = 600_000;
export const MAX_TIMEOUT_MS = 1_800_000;

export interface CodexExecArgOptions {
  cwd: string;
  brief: string;
  sandbox: SandboxMode;
  model?: string;
  resumeSessionId?: string;
  lastMessagePath: string;
}

export function buildCodexExecArgs(opts: CodexExecArgOptions): string[] {
  const args: string[] = ["exec"];
  if (opts.resumeSessionId && !isPendingSessionId(opts.resumeSessionId)) {
    args.push("resume", opts.resumeSessionId);
  }
  args.push("--json", "--skip-git-repo-check", "--cd", opts.cwd);
  // Codex 0.148: --sandbox cannot be combined with --approve-for-me.
  // --approve-for-me already selects the workspace-write sandbox.
  if (opts.sandbox === "workspace-write") {
    args.push("--approve-for-me");
  } else {
    args.push("--sandbox", opts.sandbox);
  }
  if (opts.model) {
    args.push("-m", opts.model);
  }
  args.push("-o", opts.lastMessagePath, "--", opts.brief);
  return args;
}

export function resolveCodexBin(): string {
  return process.env.CODEX_BIN?.trim() || "codex";
}
