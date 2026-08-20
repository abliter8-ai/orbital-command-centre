import { isPendingSessionId } from "@occ/core";
import type { ReasoningEffort, SandboxMode } from "@occ/core";

export const DEFAULT_SANDBOX: SandboxMode = "workspace-write";
export { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS } from "@occ/adapter-kit";

export interface CodexExecArgOptions {
  cwd: string;
  brief: string;
  sandbox: SandboxMode;
  model?: string;
  effort?: ReasoningEffort;
  resumeSessionId?: string;
  /** Absolute image paths to attach to the initial prompt (`-i`). */
  images?: string[];
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
  if (opts.effort) {
    args.push("-c", `model_reasoning_effort="${opts.effort}"`);
  }
  if (opts.images && opts.images.length > 0) {
    args.push("-i", ...opts.images);
  }
  args.push("-o", opts.lastMessagePath, "--", opts.brief);
  return args;
}

/** What `codex exec review` looks at. Exactly one variant. */
export type CodexReviewTarget =
  | { kind: "uncommitted" }
  | { kind: "base"; branch: string }
  | { kind: "commit"; sha: string }
  | { kind: "custom" };

export interface CodexReviewArgOptions {
  target: CodexReviewTarget;
  /** Custom review instructions (appended after the target flags). */
  prompt?: string;
  model?: string;
  effort?: ReasoningEffort;
  lastMessagePath: string;
}

/**
 * `codex exec review`. The review subcommand takes a narrower flag set than
 * plain exec: no --cd (the process cwd carries the repo) and no --sandbox
 * (review mode does not edit by design). No --approve-for-me, no resume.
 * Target flags and a custom prompt are mutually exclusive in the CLI — a
 * prompt is only emitted for the "custom" target.
 */
export function buildCodexReviewArgs(opts: CodexReviewArgOptions): string[] {
  const args: string[] = ["exec", "review", "--json", "--skip-git-repo-check"];
  switch (opts.target.kind) {
    case "uncommitted":
      args.push("--uncommitted");
      break;
    case "base":
      args.push("--base", opts.target.branch);
      break;
    case "commit":
      args.push("--commit", opts.target.sha);
      break;
    case "custom":
      break;
  }
  if (opts.model) {
    args.push("-m", opts.model);
  }
  if (opts.effort) {
    args.push("-c", `model_reasoning_effort="${opts.effort}"`);
  }
  args.push("-o", opts.lastMessagePath);
  if (opts.target.kind === "custom" && opts.prompt && opts.prompt.trim() !== "") {
    args.push("--", opts.prompt);
  }
  return args;
}

export function resolveCodexBin(): string {
  return process.env.CODEX_BIN?.trim() || "codex";
}
