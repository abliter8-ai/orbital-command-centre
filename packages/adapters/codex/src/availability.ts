import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { commandForBin } from "@occ/adapter-kit";
import type { Availability } from "@occ/core";
import { resolveCodexBin } from "./spawn-args.js";

export function readCodexConfigDefaults(): { model?: string; effort?: string } {
  try {
    const text = readFileSync(join(homedir(), ".codex", "config.toml"), "utf8");
    const model = text.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1];
    const effort = text.match(/^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m)?.[1];
    return { model, effort };
  } catch {
    return {};
  }
}

function runVersion(bin: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const invoked = commandForBin(bin, ["--version"]);
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

export async function probeCodexAvailability(): Promise<Availability> {
  const bin = resolveCodexBin();
  const result = await runVersion(bin);
  if (result.code === null) {
    return {
      available: false,
      authenticated: false,
      detail: `Codex CLI not found (${bin}): ${result.stderr || "spawn failed"}. Set CODEX_BIN or install Codex.`,
    };
  }
  if (result.code !== 0) {
    const combined = `${result.stdout}\n${result.stderr}`;
    const loginRequired = /not logged in|codex login|unauthori[sz]ed/i.test(combined);
    return {
      available: true,
      authenticated: !loginRequired,
      detail: combined.trim() || `codex --version exited ${result.code}`,
    };
  }
  const version = result.stdout.trim().split(/\s+/).at(-1);
  const defaults = readCodexConfigDefaults();
  const defaultBits = [
    defaults.model ? `config model=${defaults.model}` : undefined,
    defaults.effort ? `effort=${defaults.effort}` : undefined,
    "slugs: gpt-5.6-sol|gpt-5.6-terra|gpt-5.6-luna|gpt-5.6|gpt-5.5",
  ].filter(Boolean);
  return {
    available: true,
    authenticated: true,
    detail: [result.stdout.trim() || `${bin} is available`, ...defaultBits].join(" · "),
    version,
  };
}
