#!/usr/bin/env node
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { AntigravityAgentHandle } from "@occ/adapter-antigravity";
import { ClaudeAgentHandle } from "@occ/adapter-claude";
import { CodexAgentHandle } from "@occ/adapter-codex";
import { CursorAgentHandle } from "@occ/adapter-cursor";
import { GrokAgentHandle } from "@occ/adapter-grok";
import { InMemoryTaskStore, type AgentHandle, type AgentId } from "@occ/core";
import { OccAcpAgent } from "./server.js";

function parseArgs(argv: string[]): { agent: AgentId; model?: string } {
  let agent: AgentId = "codex";
  let model: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--agent" && argv[i + 1]) {
      agent = argv[i + 1] as AgentId;
    } else if (argv[i] === "--model" && argv[i + 1]) {
      model = argv[i + 1];
    }
  }
  if (!["codex", "cursor", "grok", "antigravity", "claude"].includes(agent)) {
    process.stderr.write(`occ-acp: unknown --agent "${agent}"\n`);
    process.exit(2);
  }
  return { agent, model };
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

const { agent: agentId, model } = parseArgs(process.argv.slice(2));
const store = new InMemoryTaskStore();
const occ = new OccAcpAgent({
  handle: buildHandle(agentId, store),
  store,
  model: model ?? process.env.OCC_ACP_MODEL,
});

// ACP is NDJSON over stdio; stdout is protocol, stderr is diagnostics.
acp
  .agent({ name: `occ-${agentId}` })
  .onRequest("initialize", (ctx) => occ.initialize(ctx.params))
  .onRequest("authenticate", (ctx) => occ.authenticate(ctx.params))
  .onRequest("session/new", (ctx) => occ.newSession(ctx.params))
  .onRequest("session/set_mode", (ctx) => occ.setSessionMode(ctx.params))
  .onRequest("session/prompt", (ctx) => occ.prompt(ctx.params, ctx.client))
  .onNotification("session/cancel", (ctx) => occ.cancel(ctx.params))
  .connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
