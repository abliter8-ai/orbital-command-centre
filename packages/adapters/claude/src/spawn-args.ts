import { isPendingSessionId } from "@occ/core";
import type { SandboxMode } from "@occ/core";

export const DEFAULT_SANDBOX: SandboxMode = "workspace-write";

/**
 * OCC sandbox → claude --permission-mode. read-only is `plan` (no edits, no
 * unprompted shell), workspace-write is `acceptEdits` (file edits auto-accept;
 * bare shell commands can still soft-deny headless — same caveat as agy),
 * danger-full-access is `bypassPermissions` (trusted cwds only).
 */
export const CLAUDE_PERMISSION_MODE: Record<SandboxMode, string> = {
  "read-only": "plan",
  "workspace-write": "acceptEdits",
  "danger-full-access": "bypassPermissions",
};

/**
 * Delegated children run clean: no user/project MCP servers. Without this a
 * child Claude spawned by an orchestrator that itself has orbital registered
 * would inherit the delegation tools — nested fan-out nobody asked for.
 */
export const EMPTY_MCP_CONFIG = '{"mcpServers":{}}';

export interface ClaudeHeadlessArgOptions {
  sandbox: SandboxMode;
  model?: string;
  resumeSessionId?: string;
}

export function buildClaudeHeadlessArgs(opts: ClaudeHeadlessArgOptions): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose", // required by stream-json in print mode
    "--permission-mode",
    CLAUDE_PERMISSION_MODE[opts.sandbox],
    "--strict-mcp-config",
    "--mcp-config",
    EMPTY_MCP_CONFIG,
  ];
  const model = opts.model?.trim();
  if (model) {
    args.push("--model", model);
  }
  if (opts.resumeSessionId && !isPendingSessionId(opts.resumeSessionId)) {
    args.push("--resume", opts.resumeSessionId);
  }
  return args;
}

export function resolveClaudeBin(): string {
  return process.env.CLAUDE_BIN?.trim() || "claude";
}
