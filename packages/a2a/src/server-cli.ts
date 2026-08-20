#!/usr/bin/env node
import { AntigravityAgentHandle } from "@occ/adapter-antigravity";
import { ClaudeAgentHandle } from "@occ/adapter-claude";
import { CodexAgentHandle } from "@occ/adapter-codex";
import { CursorAgentHandle } from "@occ/adapter-cursor";
import { GrokAgentHandle } from "@occ/adapter-grok";
import { InMemoryTaskStore, type AgentHandle, type AgentId } from "@occ/core";
import { buildAgentCard } from "./card.js";
import { OccAgentExecutor } from "./executor.js";
import { createA2aHttpServer } from "./http.js";

function parseArgs(argv: string[]): { agent: AgentId; port: number } {
  let agent: AgentId = "codex";
  let port = 7001;
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if (argv[i] === "--agent" && next) agent = next as AgentId;
    else if (argv[i] === "--port" && next) port = Number.parseInt(next, 10);
  }
  if (!["codex", "cursor", "grok", "antigravity", "claude"].includes(agent)) {
    process.stderr.write(`occ-a2a: unknown --agent "${agent}"\n`);
    process.exit(2);
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    process.stderr.write(`occ-a2a: bad --port\n`);
    process.exit(2);
  }
  return { agent, port };
}

function buildHandle(agent: AgentId, store: InMemoryTaskStore): AgentHandle {
  switch (agent) {
    case "cursor":
      return new CursorAgentHandle(store);
    case "grok":
      return new GrokAgentHandle(store);
    case "antigravity":
      return new AntigravityAgentHandle(store);
    case "claude":
      return new ClaudeAgentHandle(store);
    default:
      return new CodexAgentHandle(store);
  }
}

const { agent: agentId, port } = parseArgs(process.argv.slice(2));
const store = new InMemoryTaskStore();
const handle = buildHandle(agentId, store);
const url = `http://127.0.0.1:${port}`;
const server = createA2aHttpServer({
  card: buildAgentCard(agentId, url),
  executor: new OccAgentExecutor({ handle, store }),
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`occ-a2a: ${agentId} on ${url} (card: ${url}/.well-known/agent-card.json)\n`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
