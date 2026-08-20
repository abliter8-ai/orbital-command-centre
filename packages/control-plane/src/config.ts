import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentId, SandboxMode } from "@occ/core";

export const SANDBOX_ORDER: Record<SandboxMode, number> = {
  "read-only": 0,
  "workspace-write": 1,
  "danger-full-access": 2,
};

export function sandboxAllowed(requested: SandboxMode, cap: SandboxMode): boolean {
  return SANDBOX_ORDER[requested] <= SANDBOX_ORDER[cap];
}

export interface AgentPolicy {
  enabled: boolean;
  /** Requests above this sandbox level are rejected before any spawn. */
  maxSandbox: SandboxMode;
  defaultModel?: string;
  /**
   * "worktree": every delegation runs in a fresh git worktree detached at
   * HEAD, removed afterwards. Requires the delegation cwd to be a git repo.
   * Default "none".
   */
  isolation?: "none" | "worktree";
}

export interface OrbitalConfig {
  host: string;
  port: number;
  agents: Record<AgentId, AgentPolicy>;
}

const AGENT_IDS: AgentId[] = ["codex", "cursor", "grok", "antigravity"];

export function defaultConfig(): OrbitalConfig {
  return {
    host: "127.0.0.1",
    port: 7100,
    agents: {
      codex: { enabled: true, maxSandbox: "workspace-write" },
      cursor: { enabled: true, maxSandbox: "workspace-write" },
      grok: { enabled: true, maxSandbox: "workspace-write" },
      antigravity: { enabled: true, maxSandbox: "workspace-write" },
    },
  };
}

export function configPath(): string {
  return process.env.OCC_ORBITAL_CONFIG ?? join(homedir(), ".occ", "orbital.json");
}

function isSandbox(value: unknown): value is SandboxMode {
  return typeof value === "string" && value in SANDBOX_ORDER;
}

/** Load the policy file, merging over defaults; unknown values fall back. */
export function loadConfig(path: string = configPath()): OrbitalConfig {
  const config = defaultConfig();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return config; // missing or unreadable file → defaults
  }
  if (typeof raw !== "object" || raw === null) return config;
  const file = raw as Record<string, unknown>;

  if (typeof file.host === "string" && file.host.trim() !== "") config.host = file.host.trim();
  if (typeof file.port === "number" && Number.isInteger(file.port) && file.port > 0 && file.port <= 65535) {
    config.port = file.port;
  }
  const agents = file.agents;
  if (typeof agents === "object" && agents !== null) {
    for (const id of AGENT_IDS) {
      const entry = (agents as Record<string, unknown>)[id];
      if (typeof entry !== "object" || entry === null) continue;
      const policy = entry as Record<string, unknown>;
      if (typeof policy.enabled === "boolean") config.agents[id].enabled = policy.enabled;
      if (isSandbox(policy.maxSandbox)) config.agents[id].maxSandbox = policy.maxSandbox;
      if (policy.isolation === "none" || policy.isolation === "worktree") {
        config.agents[id].isolation = policy.isolation;
      }
      if (typeof policy.defaultModel === "string" && policy.defaultModel.trim() !== "") {
        config.agents[id].defaultModel = policy.defaultModel.trim();
      }
    }
  }
  return config;
}
