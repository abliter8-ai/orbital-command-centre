import { spawn } from "node:child_process";
import { commandForBin } from "@occ/adapter-kit";
import type { Availability } from "@occ/core";
import { resolveAgyBin } from "./spawn-args.js";

function run(bin: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const invoked = commandForBin(bin, args);
    const child = spawn(invoked.command, invoked.args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({ code: null, stdout: "", stderr: error.message });
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

export function isAgyLoggedIn(stdout: string, stderr: string): boolean {
  const text = `${stdout}\n${stderr}`;
  if (/authentication required|not logged in|please (log|sign) in|run `?agy/i.test(text)) {
    return false;
  }
  return true;
}

export function parseAgyModelCatalog(text: string): string[] {
  const models: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^((?:gemini|claude|gpt-oss)-[a-z0-9.-]+?)(?=[A-Z]|$)/);
    if (match?.[1]) models.push(match[1]);
  }
  return models;
}

export async function probeAgyAvailability(): Promise<Availability> {
  const bin = resolveAgyBin();
  // Version only. Do not run `agy models` as part of health — keep the next -p turn clean.
  const version = await run(bin, ["--version"]);
  if (version.code === null || version.code !== 0) {
    return {
      available: false,
      authenticated: false,
      detail: `Antigravity CLI not usable (${bin}): ${(version.stderr || version.stdout).trim() || "spawn failed"}. Set AGY_BIN or install agy. Never use the binary named gemini.`,
    };
  }

  const authenticated = isAgyLoggedIn(version.stdout, version.stderr);
  const versionLabel = (version.stdout.trim().split("\n")[0] ?? version.stdout.trim()) || "agy";
  const modelHint =
    "bin=agy · slugs: gemini-3.7-flash-high|gemini-3.5-flash-medium|gemini-3.1-pro-high|claude-sonnet-4-6|claude-opus-4-6-thinking · effort via --effort low|medium|high";

  return {
    available: true,
    authenticated,
    detail: authenticated
      ? `${versionLabel} — authenticated · ${modelHint}`
      : `${versionLabel} — not signed in. Run interactive \`agy\` once, or set modelProvider=gemini + GEMINI_API_KEY. ${modelHint}`,
    version: versionLabel,
  };
}
