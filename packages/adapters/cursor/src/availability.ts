import { spawn } from "node:child_process";
import { commandForBin } from "@occ/adapter-kit";
import type { Availability } from "@occ/core";
import { cursorSpawnEnv, resolveCursorBin } from "./spawn-args.js";

function run(bin: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const invoked = commandForBin(bin, args);
    const child = spawn(invoked.command, invoked.args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: cursorSpawnEnv(),
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

export async function probeCursorAvailability(): Promise<Availability> {
  const bin = resolveCursorBin();
  const version = await run(bin, ["--version"]);
  if (version.code === null || version.code !== 0) {
    const combined = `${version.stdout}\n${version.stderr}`;
    const keychain = /keychain is locked/i.test(combined);
    return {
      available: false,
      authenticated: false,
      detail: keychain
        ? `Cursor agent CLI found but the login keychain is locked. Unlock it or keep AGENT_CLI_CREDENTIAL_STORE=file. (${bin})`
        : `Cursor agent CLI not usable (${bin}): ${combined.trim() || "spawn failed"}. Set CURSOR_BIN or install the Cursor agent CLI.`,
    };
  }

  const status = await run(bin, ["status"]);
  const statusText = `${status.stdout}\n${status.stderr}`;
  const notSignedIn =
    /not signed in|not logged in|unauthenticated|please sign in/i.test(statusText);
  const loggedIn = /logged in/i.test(statusText);
  const authenticated = !notSignedIn && (loggedIn || status.code === 0);

  return {
    available: true,
    authenticated,
    detail: authenticated
      ? `${version.stdout.trim()} — ${status.stdout.trim() || "authenticated"}`
      : `${version.stdout.trim()} — not signed in. Run \`agent login\`.`,
    version: version.stdout.trim().split(/\s+/).at(-1),
  };
}
