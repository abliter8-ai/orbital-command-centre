#!/usr/bin/env node
// Detached child process entry — spawned by `orbital up`. stdout/stderr are
// redirected to ~/.occ/daemon/daemon.log by the CLI.
import { AntigravityAgentHandle } from "@occ/adapter-antigravity";
import { CodexAgentHandle } from "@occ/adapter-codex";
import { CursorAgentHandle } from "@occ/adapter-cursor";
import { GrokAgentHandle } from "@occ/adapter-grok";
import { InMemoryTaskStore, type AgentHandle, type AgentId } from "@occ/core";
import { AuditLog } from "./audit.js";
import { loadConfig } from "./config.js";
import { createDaemonServer } from "./daemon.js";

function buildHandles(): Record<AgentId, AgentHandle> {
  return {
    codex: new CodexAgentHandle(new InMemoryTaskStore()),
    cursor: new CursorAgentHandle(new InMemoryTaskStore()),
    grok: new GrokAgentHandle(new InMemoryTaskStore()),
    antigravity: new AntigravityAgentHandle(new InMemoryTaskStore()),
  };
}

const config = loadConfig();
const server = createDaemonServer({
  config,
  handles: buildHandles(),
  audit: new AuditLog(),
});

server.listen(config.port, config.host, () => {
  process.stdout.write(
    `orbital: control plane on http://${config.host}:${config.port} ` +
      `(agents: codex cursor grok antigravity)\n`,
  );
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
