import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Antigravity native research: google_search + read_url via `agy -p`.
 *
 * Web actions default to Ask and are soft-denied in headless mode unless an
 * allow rule exists in ~/.gemini/antigravity-cli/settings.json. The pre-flight
 * helpers below check (and with consent, fix) those rules before a research
 * run so the delegation does not silently come back empty.
 */

/** Minimum allow rules for headless research. Browser control (execute_url) is deliberately not included. */
export const RESEARCH_ALLOW_RULES = ["read_url(*)"] as const;

export function agySettingsPath(): string {
  return (
    process.env.OCC_AGY_SETTINGS?.trim() ||
    join(homedir(), ".gemini", "antigravity-cli", "settings.json")
  );
}

export interface AgyPermissionPreflight {
  settingsPath: string;
  /** false when the settings file is missing or not valid JSON */
  readable: boolean;
  /** research rules already present in permissions.allow */
  present: string[];
  /** research rules not yet allowed */
  missing: string[];
  /** full current allow list (empty when unreadable) */
  allowRules: string[];
}

export async function checkResearchPermissions(
  settingsPath: string = agySettingsPath(),
): Promise<AgyPermissionPreflight> {
  let allowRules: string[] = [];
  let readable = true;
  try {
    const raw = await readFile(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as { permissions?: { allow?: unknown } };
    const allow = parsed?.permissions?.allow;
    if (Array.isArray(allow)) {
      allowRules = allow.filter((r): r is string => typeof r === "string");
    }
  } catch {
    readable = false;
  }
  const present = RESEARCH_ALLOW_RULES.filter((r) => allowRules.includes(r));
  const missing = RESEARCH_ALLOW_RULES.filter((r) => !allowRules.includes(r));
  return { settingsPath, readable, present, missing, allowRules };
}

export interface ApplyAllowResult {
  settingsPath: string;
  added: string[];
  backupPath?: string;
}

/**
 * Merge the research allow rules into the user's agy settings. Any existing
 * file — valid JSON or not — is backed up first (timestamped .occ-backup-*
 * sibling); a malformed file is then replaced with a minimal valid one rather
 * than silently destroyed. Creates the settings file (and directories) when
 * absent.
 */
export async function applyResearchAllowRules(
  settingsPath: string = agySettingsPath(),
): Promise<ApplyAllowResult> {
  const pre = await checkResearchPermissions(settingsPath);
  if (pre.missing.length === 0) {
    return { settingsPath, added: [] };
  }
  let settings: Record<string, unknown> = {};
  let backupPath: string | undefined;
  let raw: string | undefined;
  try {
    raw = await readFile(settingsPath, "utf8");
  } catch {
    raw = undefined; // file absent — nothing to preserve
  }
  if (raw !== undefined) {
    backupPath = `${settingsPath}.occ-backup-${Date.now()}`;
    await copyFile(settingsPath, backupPath);
    if (pre.readable) {
      settings = JSON.parse(raw) as Record<string, unknown>;
    }
  }
  const permissions = (settings.permissions ?? {}) as Record<string, unknown>;
  const existing = Array.isArray(permissions.allow) ? (permissions.allow as unknown[]) : [];
  permissions.allow = [...new Set([...existing, ...pre.missing])];
  settings.permissions = permissions;
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  return { settingsPath, added: [...pre.missing], backupPath };
}

export interface AgyResearchBriefOptions {
  question: string;
  /** Specific pages to fetch and read in full. */
  fetchPages?: string[];
  /** Allow agy to spawn subagents for parallel sub-questions. */
  subagents?: boolean;
}

export function buildResearchBrief(opts: AgyResearchBriefOptions): string {
  const lines = [
    "Research task. Use your web tools (google_search for discovery, read_url for page content) — do not guess at current facts.",
    "",
    `Question: ${opts.question}`,
  ];
  if (opts.fetchPages && opts.fetchPages.length > 0) {
    lines.push("", "Fetch and read these pages in full:", ...opts.fetchPages.map((u) => `- ${u}`));
  }
  if (opts.subagents) {
    lines.push(
      "",
      "Spawn subagents to research independent sub-questions in parallel, then synthesize their findings.",
    );
  }
  lines.push(
    "",
    "Report format:",
    "1. Findings — the answer, organized by sub-topic.",
    "2. Sources — every claim tied to a URL you actually fetched.",
    "3. Gaps — what you could not verify.",
    "Do not edit files in the workspace.",
  );
  return lines.join("\n");
}
