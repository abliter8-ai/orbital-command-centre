import { spawn } from "node:child_process";
import { commandForBin } from "@occ/adapter-kit";
import type { Availability } from "@occ/core";
import { grokSpawnEnv, resolveGrokBin } from "./spawn-args.js";

function run(bin: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const invoked = commandForBin(bin, args);
    const child = spawn(invoked.command, invoked.args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: grokSpawnEnv(),
    });
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

export function parseGrokModelCatalog(text: string): { defaultModel?: string; models: string[] } {
  const defaultModel = text.match(/Default model:\s+(\S+)/i)?.[1];
  const models: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*[*+-]\s+(\S+)/);
    if (match?.[1]) models.push(match[1]);
  }
  return { defaultModel, models };
}

export function isGrokLoggedIn(stdout: string, stderr: string): boolean {
  const text = `${stdout}\n${stderr}`;
  if (/not logged in|please (log|sign) in|authentication required|run `?grok login/i.test(text)) {
    return false;
  }
  return true;
}

export async function probeGrokAvailability(): Promise<Availability> {
  const bin = resolveGrokBin();
  // Do not run `grok models` here: on 1.0.5 it poisons the next `grok -p` in this
  // process tree (empty stdout until SIGTERM). Version is enough for health.
  const version = await run(bin, ["--no-leader", "--version"]);
  if (version.code === null || version.code !== 0) {
    return {
      available: false,
      authenticated: false,
      detail: `Grok CLI not usable (${bin}): ${(version.stderr || version.stdout).trim() || "spawn failed"}. Set GROK_BIN or install grok. Never use the binary named agent.`,
    };
  }

  const authenticated = isGrokLoggedIn(version.stdout, version.stderr);
  const versionLabel = version.stdout.trim().split("\n")[0] ?? version.stdout.trim();
  const modelHint = "bin=grok · default model=grok-4.6 · slugs: grok-4.6|grok-4.5 · effort via --effort";

  return {
    available: true,
    authenticated,
    detail: authenticated
      ? `${versionLabel} — authenticated · ${modelHint}`
      : `${versionLabel} — not signed in. Run \`grok login\`. ${modelHint}`,
    version: versionLabel.split(/\s+/)[1],
  };
}
