import { spawn } from "node:child_process";
import { commandForBin } from "@occ/adapter-kit";
import type { Availability } from "@occ/core";
import { resolveClaudeBin } from "./spawn-args.js";

function run(
  bin: string,
  args: string[],
  timeoutMs = 10_000,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const invoked = commandForBin(bin, args);
    const child = spawn(invoked.command, invoked.args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: null, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout: "", stderr: error.message, timedOut: false });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut: false });
    });
  });
}

export interface ClaudeAuthStatus {
  loggedIn?: boolean;
  authMethod?: string;
  email?: string;
}

export function parseAuthStatus(text: string): ClaudeAuthStatus | null {
  try {
    const parsed = JSON.parse(text) as ClaudeAuthStatus;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export async function probeClaudeAvailability(): Promise<Availability> {
  const bin = resolveClaudeBin();
  const version = await run(bin, ["--version"]);
  if (version.code !== 0) {
    return {
      available: false,
      authenticated: false,
      detail: `Claude Code CLI not usable (${bin}): ${(version.stdout + version.stderr).trim() || "spawn failed"}. Install Claude Code or set CLAUDE_BIN.`,
    };
  }

  const auth = await run(bin, ["auth", "status"]);
  const status = parseAuthStatus(auth.stdout);
  const authenticated = status?.loggedIn === true;
  const versionLabel = version.stdout.trim();
  const modelHint = "slugs: sonnet|opus|haiku|full IDs · effort: n/a (baked into model choice)";

  return {
    available: true,
    authenticated,
    detail: authenticated
      ? `${versionLabel} — logged in (${status?.authMethod ?? "unknown"}${status?.email ? `, ${status.email}` : ""}) · ${modelHint}`
      : `${versionLabel} — not logged in. Run \`claude auth login\`. ${modelHint}`,
    version: versionLabel.split(/\s+/)[0],
  };
}
