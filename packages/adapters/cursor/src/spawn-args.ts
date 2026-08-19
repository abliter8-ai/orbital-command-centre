import { isPendingSessionId } from "@occ/core";
import type { SandboxMode } from "@occ/core";

export const DEFAULT_SANDBOX: SandboxMode = "workspace-write";

export interface CursorHeadlessArgOptions {
  cwd: string;
  sandbox: SandboxMode;
  model?: string;
  resumeSessionId?: string;
}

export function outputFormatForSandbox(sandbox: SandboxMode): "json" | "stream-json" {
  return sandbox === "read-only" ? "json" : "stream-json";
}

export function buildHeadlessArgs(opts: CursorHeadlessArgOptions): string[] {
  const format = outputFormatForSandbox(opts.sandbox);
  const args = ["-p", "--output-format", format];
  if (format === "stream-json") {
    args.push("--stream-partial-output");
  }
  const model = opts.model?.trim() ? opts.model.trim() : "auto";
  args.push("--model", model);
  if (opts.sandbox === "read-only") {
    args.push("--mode", "ask", "--force");
  } else {
    args.push("--force", "--trust");
  }
  if (opts.sandbox === "danger-full-access") {
    args.push("--sandbox", "disabled");
  }
  args.push("--workspace", opts.cwd);
  if (opts.resumeSessionId && !isPendingSessionId(opts.resumeSessionId)) {
    args.push("--resume", opts.resumeSessionId);
  }
  return args;
}

export function resolveCursorBin(): string {
  return process.env.CURSOR_BIN?.trim() || "agent";
}

export function cursorSpawnEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    AGENT_CLI_CREDENTIAL_STORE: base.AGENT_CLI_CREDENTIAL_STORE ?? "file",
  };
}
