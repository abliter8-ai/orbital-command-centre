import { isPendingSessionId } from "@occ/core";
import type { ReasoningEffort, SandboxMode } from "@occ/core";

export const DEFAULT_SANDBOX: SandboxMode = "workspace-write";

export interface GrokHeadlessArgOptions {
  cwd: string;
  brief: string;
  sandbox: SandboxMode;
  model?: string;
  effort?: ReasoningEffort;
  resumeSessionId?: string;
  /** Hard-block the generic web path so X tools must be used (live X retrieval). */
  disableWebSearch?: boolean;
  /** Cap tool loops; media generation needs more than the default. */
  maxTurns?: number;
}

export function grokSandboxFlag(sandbox: SandboxMode): string | undefined {
  void sandbox;
  return undefined;
}

export function buildHeadlessArgs(opts: GrokHeadlessArgOptions): string[] {
  // `--no-leader` is required when OCC is spawned from a Grok session: without
  // it the child attaches to the parent leader and never returns.
  // grok 1.0.5 `--sandbox` hangs headless on this machine; do not pass it.
  // `--always-approve` is write-only (also hangs if combined with --sandbox).
  // Spawn cwd is set by runChild; do not also pass --cwd.
  const args = [
    "--no-auto-update",
    "--no-alt-screen",
    "--no-leader",
    "--output-format",
    "json",
    "--verbatim",
  ];
  if (opts.sandbox !== "read-only") {
    args.push("--always-approve");
  }
  if (opts.disableWebSearch) {
    args.push("--disable-web-search");
  }
  if (opts.maxTurns !== undefined && Number.isInteger(opts.maxTurns) && opts.maxTurns > 0) {
    args.push("--max-turns", String(opts.maxTurns));
  }
  if (opts.model?.trim()) {
    args.push("-m", opts.model.trim());
  }
  if (opts.effort) {
    args.push("--effort", opts.effort);
  }
  if (opts.resumeSessionId && !isPendingSessionId(opts.resumeSessionId)) {
    args.push("-r", opts.resumeSessionId);
  }
  args.push("-p", opts.brief);
  return args;
}

export function resolveGrokBin(): string {
  // Never `agent` — that name collides with Cursor's old CLI and Grok's own agent binary.
  return process.env.GROK_BIN?.trim() || "grok";
}

const NESTED_GROK_ENV = ["GROK_AGENT", "GROK_SESSION_ID", "GROK_AGENT_NAME"] as const;

export function grokSpawnEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const key of NESTED_GROK_ENV) {
    delete env[key];
  }
  return env;
}
