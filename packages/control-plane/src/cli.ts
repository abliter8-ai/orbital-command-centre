#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditPath } from "./audit.js";
import { loadConfig } from "./config.js";

const stateDir = join(homedir(), ".occ", "daemon");
const pidFile = join(stateDir, "pid");
const logFile = join(stateDir, "daemon.log");

function readPid(): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
    if (Number.isInteger(pid) && pid > 0) {
      process.kill(pid, 0); // throws if not running
      return pid;
    }
  } catch {
    // no pidfile or stale
  }
  return undefined;
}

async function waitForHealth(port: number, host: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${host}:${port}/v1/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function up(): Promise<void> {
  const existing = readPid();
  if (existing) {
    process.stdout.write(`orbital: already running (pid ${existing})\n`);
    return;
  }
  const config = loadConfig();
  mkdirSync(stateDir, { recursive: true });
  const daemonMain = fileURLToPath(new URL("./daemon-main.js", import.meta.url));
  const logFd = openSync(logFile, "a");
  const child = spawn(process.execPath, [daemonMain], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: process.env,
  });
  child.unref();
  if (!child.pid) throw new Error("failed to spawn daemon");
  // Write the pidfile only after the child proves it can serve.
  const healthy = await waitForHealth(config.port, config.host, 10_000);
  if (!healthy) {
    try {
      process.kill(child.pid, "SIGTERM");
    } catch {
      // already gone
    }
    throw new Error(`daemon did not become healthy; see ${logFile}`);
  }
  mkdirSync(stateDir, { recursive: true });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(pidFile, `${child.pid}\n`, "utf8");
  process.stdout.write(
    `orbital: up (pid ${child.pid}) on http://${config.host}:${config.port}\n` +
      `  registry: http://${config.host}:${config.port}/v1/registry\n` +
      `  log: ${logFile}\n`,
  );
}

async function down(): Promise<void> {
  const pid = readPid();
  if (!pid) {
    rmSync(pidFile, { force: true });
    process.stdout.write("orbital: not running\n");
    return;
  }
  process.kill(pid, "SIGTERM");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch {
      break;
    }
  }
  try {
    process.kill(pid, 0);
    process.kill(pid, "SIGKILL");
  } catch {
    // already exited
  }
  rmSync(pidFile, { force: true });
  process.stdout.write("orbital: down\n");
}

async function status(): Promise<void> {
  const pid = readPid();
  const config = loadConfig();
  if (!pid) {
    process.stdout.write("orbital: not running\n");
    return;
  }
  process.stdout.write(`orbital: running (pid ${pid})\n`);
  try {
    const res = await fetch(`http://${config.host}:${config.port}/v1/health`);
    const health = (await res.json()) as {
      ok: boolean;
      uptimeMs: number;
      agents: Record<string, { enabled: boolean; available: boolean; authenticated: boolean; detail: string }>;
    };
    process.stdout.write(`  uptime: ${Math.round(health.uptimeMs / 1000)}s\n`);
    for (const [id, agent] of Object.entries(health.agents)) {
      const mark = agent.enabled && agent.available && agent.authenticated ? "ok " : "!! ";
      process.stdout.write(
        `  ${mark}${id}: enabled=${agent.enabled} available=${agent.available} authenticated=${agent.authenticated} — ${agent.detail}\n`,
      );
    }
  } catch (error) {
    process.stdout.write(`  health check failed: ${error instanceof Error ? error.message : error}\n`);
  }
}

function tailFile(file: string, lines: number): void {
  if (!existsSync(file)) {
    process.stdout.write(`(no ${file} yet)\n`);
    return;
  }
  const content = readFileSync(file, "utf8").split("\n").filter((line) => line !== "");
  for (const line of content.slice(-lines)) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if ("agentId" in parsed) {
        process.stdout.write(
          `${parsed.ts} ${parsed.agentId} ${parsed.status} ${parsed.durationMs}ms` +
            `${parsed.error ? ` — ${parsed.error}` : ""}\n`,
        );
        continue;
      }
    } catch {
      // not JSON — print raw
    }
    process.stdout.write(`${line}\n`);
  }
}

const command = process.argv[2];
const linesArg = process.argv.indexOf("--lines");
const lines = linesArg >= 0 ? Number.parseInt(process.argv[linesArg + 1] ?? "20", 10) : 20;

switch (command) {
  case "up":
    await up();
    break;
  case "down":
    await down();
    break;
  case "status":
    await status();
    break;
  case "audit":
    tailFile(auditPath(), lines);
    break;
  case "logs":
    tailFile(logFile, lines);
    break;
  default:
    process.stdout.write(
      "orbital — OCC control plane\n" +
        "  up        start the daemon (detached)\n" +
        "  down      stop the daemon\n" +
        "  status    health + per-agent availability\n" +
        "  audit     recent delegations [--lines N]\n" +
        "  logs      daemon log tail [--lines N]\n",
    );
    process.exit(command ? 2 : 0);
}
