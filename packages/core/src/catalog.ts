import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentId } from "./types.js";

export interface AgentModelCatalog {
  agentId: AgentId;
  /** ISO timestamp of the last successful live probe, or null for built-in defaults. */
  fetchedAt: string | null;
  cliVersion?: string;
  defaultModel?: string;
  models: string[];
  source: "live" | "static";
  note?: string;
}

export interface ModelCatalog {
  version: 1;
  updatedAt: string | null;
  agents: Record<AgentId, AgentModelCatalog>;
}

export const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export function catalogPath(): string {
  return process.env.OCC_CATALOG_PATH?.trim() || join(homedir(), ".occ", "model-catalog.json");
}

/**
 * Built-in fallback, used when no live probe has ever run (or the file is
 * unreadable). Keep these aligned with the per-agent caution notes in
 * tools.ts — they are the last line of defence, not the catalog.
 */
export function defaultCatalog(): ModelCatalog {
  return {
    version: 1,
    updatedAt: null,
    agents: {
      codex: {
        agentId: "codex",
        fetchedAt: null,
        source: "static",
        models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6", "gpt-5.5"],
        note: "Codex CLI has no models subcommand; static slugs plus ~/.codex/config.toml default.",
      },
      cursor: {
        agentId: "cursor",
        fetchedAt: null,
        source: "static",
        defaultModel: "auto",
        models: ["auto", "gpt-5", "sonnet-4-thinking"],
        note: "Static fallback. Run scripts/update-models for the live `cursor-agent --list-models` catalog.",
      },
      grok: {
        agentId: "grok",
        fetchedAt: null,
        source: "static",
        defaultModel: "grok-4.6",
        models: ["grok-4.6", "grok-4.5"],
        note: "Static fallback. Run scripts/update-models for the live `grok models` catalog (includes local aliases).",
      },
      antigravity: {
        agentId: "antigravity",
        fetchedAt: null,
        source: "static",
        models: [
          "gemini-3.7-flash-high",
          "gemini-3.5-flash-medium",
          "gemini-3.1-pro-high",
          "claude-sonnet-4-6",
          "claude-opus-4-6-thinking",
        ],
        note: "Static fallback. Run scripts/update-models for the live `agy models` catalog.",
      },
    },
  };
}

function isAgentEntry(value: unknown): value is AgentModelCatalog {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<AgentModelCatalog>;
  return typeof entry.agentId === "string" && Array.isArray(entry.models);
}

/**
 * Load the user catalog file and overlay it on the built-in defaults, per
 * agent. A malformed or missing file never breaks startup — defaults win.
 */
export function loadCatalog(path: string = catalogPath()): ModelCatalog {
  const catalog = defaultCatalog();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return catalog;
  }
  if (typeof parsed !== "object" || parsed === null) return catalog;
  const file = parsed as Partial<ModelCatalog>;
  if (typeof file.updatedAt === "string") catalog.updatedAt = file.updatedAt;
  const agents = file.agents;
  if (typeof agents !== "object" || agents === null) return catalog;
  for (const agentId of ["codex", "cursor", "grok", "antigravity"] as const) {
    const entry = (agents as Record<string, unknown>)[agentId];
    if (isAgentEntry(entry) && entry.agentId === agentId) {
      catalog.agents[agentId] = { ...entry, models: [...entry.models] };
    }
  }
  return catalog;
}

export function saveCatalog(catalog: ModelCatalog, path: string = catalogPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}

export function catalogAgeMs(catalog: ModelCatalog, now: number = Date.now()): number | null {
  if (!catalog.updatedAt) return null;
  const at = Date.parse(catalog.updatedAt);
  return Number.isNaN(at) ? null : now - at;
}

export function isCatalogStale(
  catalog: ModelCatalog,
  maxAgeMs: number = CATALOG_MAX_AGE_MS,
): boolean {
  const age = catalogAgeMs(catalog);
  return age === null || age > maxAgeMs;
}
