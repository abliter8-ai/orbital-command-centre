import { runChild } from "@occ/adapter-kit";
import { resolveClaudeBin } from "@occ/adapter-claude";
import { readCodexConfigDefaults, resolveCodexBin } from "@occ/adapter-codex";
import { cursorSpawnEnv, resolveCursorBin } from "@occ/adapter-cursor";
import { grokSpawnEnv, parseGrokModelCatalog, resolveGrokBin } from "@occ/adapter-grok";
import { parseAgyModelCatalog, resolveAgyBin } from "@occ/adapter-antigravity";
import type { AgentId } from "@occ/core";
import type { AgentModelCatalog } from "./catalog.js";

const PROBE_TIMEOUT_MS = 25_000;
const VERSION_TIMEOUT_MS = 10_000;

/**
 * Parse `cursor-agent --list-models`: a header line, then "<slug> - <label>"
 * lines with "(default)" marking the default.
 */
export function parseCursorModelList(text: string): { defaultModel?: string; models: string[] } {
  const models: string[] = [];
  let defaultModel: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(\S+)\s+-\s+\S/);
    if (!match?.[1]) continue;
    const slug = match[1];
    if (!/^\w[\w.-]*$/.test(slug)) continue;
    models.push(slug);
    if (/\(default\)/i.test(line)) defaultModel = slug;
  }
  return { defaultModel, models };
}

async function probeVersion(bin: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string | undefined> {
  const ran = await runChild({
    bin,
    args,
    cwd: process.cwd(),
    timeoutMs: VERSION_TIMEOUT_MS,
    env,
  });
  if (ran.code !== 0) return undefined;
  const line = (ran.stdout.trim().split("\n")[0] ?? "").trim();
  return line === "" ? undefined : line;
}

async function probeCodex(): Promise<AgentModelCatalog | null> {
  // Codex has no models subcommand (0.148). Refresh what we can: CLI version
  // and the configured default; the slug list itself stays curated-static.
  const bin = resolveCodexBin();
  const versionLabel = await probeVersion(bin, ["--version"]);
  if (versionLabel === undefined) return null;
  const defaults = readCodexConfigDefaults();
  return {
    agentId: "codex",
    fetchedAt: new Date().toISOString(),
    cliVersion: versionLabel.split(/\s+/).at(-1),
    defaultModel: defaults.model,
    models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6", "gpt-5.5"],
    source: "static",
    note: "Codex CLI has no models subcommand; static slugs plus ~/.codex/config.toml default.",
  };
}

async function probeCursor(): Promise<AgentModelCatalog | null> {
  const bin = resolveCursorBin();
  const env = cursorSpawnEnv();
  const ran = await runChild({
    bin,
    args: ["--list-models"],
    cwd: process.cwd(),
    timeoutMs: PROBE_TIMEOUT_MS,
    env,
  });
  if (ran.code !== 0 || ran.timedOut) return null;
  const { defaultModel, models } = parseCursorModelList(ran.stdout);
  if (models.length === 0) return null;
  const versionLabel = await probeVersion(bin, ["--version"], env);
  return {
    agentId: "cursor",
    fetchedAt: new Date().toISOString(),
    cliVersion: versionLabel?.split(/\s+/).at(-1),
    defaultModel,
    models,
    source: "live",
    note: "Live `cursor-agent --list-models`. Parameterized form name[context=1m,effort=high,fast=false] still applies.",
  };
}

async function probeGrok(): Promise<AgentModelCatalog | null> {
  const bin = resolveGrokBin();
  const env = grokSpawnEnv();
  // Standalone probe process with a stripped env: safe here. Never fold this
  // into occ_health — `grok models` poisons a following `grok -p` in the same
  // process tree on 1.0.5.
  const ran = await runChild({
    bin,
    args: ["--no-auto-update", "--no-leader", "models"],
    cwd: process.cwd(),
    timeoutMs: PROBE_TIMEOUT_MS,
    env,
  });
  if (ran.code !== 0 || ran.timedOut) return null;
  const { defaultModel, models } = parseGrokModelCatalog(ran.stdout);
  if (models.length === 0) return null;
  const versionLabel = await probeVersion(bin, ["--no-leader", "--version"], env);
  return {
    agentId: "grok",
    fetchedAt: new Date().toISOString(),
    cliVersion: versionLabel?.split(/\s+/)[1],
    defaultModel,
    models,
    source: "live",
    note: "Live `grok models` (clean env). Local aliases (dsv4-*, glm-*, minimax-*) included when present.",
  };
}

async function probeAntigravity(): Promise<AgentModelCatalog | null> {
  const bin = resolveAgyBin();
  const ran = await runChild({
    bin,
    args: ["models"],
    cwd: process.cwd(),
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  if (ran.code !== 0 || ran.timedOut) return null;
  const models = parseAgyModelCatalog(ran.stdout);
  if (models.length === 0) return null;
  const versionLabel = await probeVersion(bin, ["--version"]);
  return {
    agentId: "antigravity",
    fetchedAt: new Date().toISOString(),
    cliVersion: versionLabel,
    models,
    source: "live",
    note: "Live `agy models`. Unknown --model is a hard ERROR.",
  };
}

/**
 * Probe every agent sequentially (Grok last, out of an abundance of caution
 * around its CLI state). Null entries mean "probe failed — keep the previous
 * catalog entry".
 */
async function probeClaude(): Promise<AgentModelCatalog | null> {
  // Claude Code has no non-interactive models listing (`claude models` is an
  // interactive picker). Refresh the CLI version; aliases stay curated-static.
  const bin = resolveClaudeBin();
  const versionLabel = await probeVersion(bin, ["--version"]);
  if (versionLabel === undefined) return null;
  return {
    agentId: "claude",
    fetchedAt: new Date().toISOString(),
    cliVersion: versionLabel.split(/\s+/)[0],
    models: ["sonnet", "opus", "haiku"],
    source: "static",
    note: "Claude Code has no non-interactive models listing; aliases track the account's current generation. Full model IDs also work.",
  };
}

export async function probeAllModels(): Promise<Record<AgentId, AgentModelCatalog | null>> {
  const codex = await probeCodex();
  const cursor = await probeCursor();
  const antigravity = await probeAntigravity();
  const claude = await probeClaude();
  const grok = await probeGrok();
  return { codex, cursor, grok, antigravity, claude };
}
