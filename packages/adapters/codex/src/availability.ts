import { spawn } from "node:child_process";
import type { Availability } from "@occ/core";
import { commandForBin } from "./run-exec.js";
import { resolveCodexBin } from "./spawn-args.js";

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
  return {
    available: true,
    authenticated: true,
    detail: result.stdout.trim() || `${bin} is available`,
    version,
  };
}
