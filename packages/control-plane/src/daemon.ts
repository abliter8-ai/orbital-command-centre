import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import {
  buildAgentCard,
  createAgentRpcHandler,
  defaultTasksDir,
  OccAgentExecutor,
  writeRpcResult,
  type AgentRpcHandler,
} from "@occ/a2a";
import {
  InMemoryTaskStore,
  loadCatalog,
  nativeCapabilities,
  type AgentHandle,
  type AgentId,
  type Availability,
} from "@occ/core";
import type { AuditLog } from "./audit.js";
import type { OrbitalConfig } from "./config.js";
import { EnforcingExecutor } from "./enforcing-executor.js";
import { WorktreeHandle, sweepStaleWorktrees, worktreeRoot } from "./worktree.js";

const AGENT_IDS: AgentId[] = ["codex", "cursor", "grok", "antigravity", "claude"];
const AVAILABILITY_TTL_MS = 30_000;

export interface DaemonDeps {
  config: OrbitalConfig;
  handles: Record<AgentId, AgentHandle>;
  audit: AuditLog;
  /** Directory for per-agent durable task files. Default: ~/.occ/a2a-tasks. */
  tasksDir?: string;
  /** Test hook: override the availability probe. */
  probe?: (handle: AgentHandle) => Promise<Availability>;
}

interface AgentRuntime {
  rpc: AgentRpcHandler;
  card: unknown;
  cardUrl: string;
  availability?: { at: number; value: Availability };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The Orbital control plane: one HTTP surface hosting every agent's A2A
 * endpoint under /agents/<id>, plus the local registry, health, and audit
 * read-back. Policy is mediated per request by EnforcingExecutor.
 */
export function createDaemonServer(deps: DaemonDeps): Server {
  const { config, audit } = deps;
  const startedAt = Date.now();
  const baseUrl = `http://${config.host}:${config.port}`;
  const runtimes = new Map<AgentId, AgentRuntime>();

  const probe = deps.probe ?? ((handle: AgentHandle) => handle.isAvailable());

  const availabilityFor = async (id: AgentId): Promise<Availability> => {
    const runtime = runtimes.get(id);
    if (runtime?.availability && Date.now() - runtime.availability.at < AVAILABILITY_TTL_MS) {
      return runtime.availability.value;
    }
    const value = await probe(deps.handles[id]);
    if (runtime) runtime.availability = { at: Date.now(), value };
    return value;
  };

  // Clean up worktrees orphaned by a previous crashed daemon before serving.
  void sweepStaleWorktrees(worktreeRoot(), audit).catch(() => undefined);

  const tasksDir = deps.tasksDir ?? defaultTasksDir();
  for (const id of AGENT_IDS) {
    const handle =
      config.agents[id].isolation === "worktree"
        ? new WorktreeHandle(deps.handles[id], { audit })
        : deps.handles[id];
    const store = new InMemoryTaskStore();
    const card = buildAgentCard(id, `${baseUrl}/agents/${id}`);
    const inner = new OccAgentExecutor({
      handle,
      store,
      defaultSandbox: "workspace-write",
    });
    const executor = new EnforcingExecutor({
      agentId: id,
      inner,
      policy: config.agents[id],
      audit,
      availability: () => availabilityFor(id),
    });
    runtimes.set(id, {
      rpc: createAgentRpcHandler({
        card,
        executor,
        // Per-agent durable store: tasks survive a daemon crash or restart.
        taskStorePath: join(tasksDir, `daemon-${id}.json`),
      }),
      card,
      cardUrl: `${baseUrl}/agents/${id}/.well-known/agent-card.json`,
    });
  }

  return createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", baseUrl);
      const path = url.pathname;

      if (req.method === "GET" && path === "/") {
        sendJson(res, 200, {
          service: "orbital",
          version: "0.1.0",
          agents: AGENT_IDS.map((id) => ({
            id,
            card: runtimes.get(id)?.cardUrl,
            rpc: `${baseUrl}/agents/${id}`,
          })),
          endpoints: ["/v1/health", "/v1/registry", "/v1/audit"],
        });
        return;
      }

      if (req.method === "GET" && path === "/v1/health") {
        const agents: Record<string, unknown> = {};
        for (const id of AGENT_IDS) {
          const availability = await availabilityFor(id);
          agents[id] = { enabled: config.agents[id].enabled, ...availability };
        }
        sendJson(res, 200, { ok: true, uptimeMs: Date.now() - startedAt, agents });
        return;
      }

      if (req.method === "GET" && path === "/v1/registry") {
        const catalog = loadCatalog();
        const capabilities = nativeCapabilities();
        const agents: Record<string, unknown> = {};
        for (const id of AGENT_IDS) {
          agents[id] = {
            policy: config.agents[id],
            availability: await availabilityFor(id),
            models: catalog.agents[id],
            capabilities: capabilities[id],
            card: runtimes.get(id)?.cardUrl,
          };
        }
        sendJson(res, 200, { updatedAt: catalog.updatedAt, agents });
        return;
      }

      if (req.method === "GET" && path === "/v1/audit") {
        const limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
        sendJson(res, 200, { entries: audit.read(Number.isInteger(limit) ? limit : 50) });
        return;
      }

      const agentMatch = path.match(/^\/agents\/([a-z]+)(\/.*)?$/);
      if (agentMatch) {
        const id = agentMatch[1] as AgentId;
        const runtime = runtimes.get(id);
        const sub = agentMatch[2] ?? "";
        if (!runtime || !AGENT_IDS.includes(id)) {
          sendJson(res, 404, { error: `unknown agent "${id}"` });
          return;
        }
        if (req.method === "GET" &&
            (sub === "/.well-known/agent-card.json" || sub === "/.well-known/agent.json")) {
          // Rewrite the interface URL from the Host header so the card is
          // correct on ephemeral ports and behind proxies.
          const card = structuredClone(runtime.card) as {
            supportedInterfaces: { url: string }[];
          };
          const host = req.headers.host ?? `${config.host}:${config.port}`;
          if (card.supportedInterfaces[0]) {
            card.supportedInterfaces[0].url = `http://${host}/agents/${id}`;
          }
          sendJson(res, 200, card);
          return;
        }
        if (req.method === "POST" && (sub === "" || sub === "/" || sub === "/rpc")) {
          await writeRpcResult(res, await runtime.rpc(await readBody(req)));
          return;
        }
        sendJson(res, 404, { error: "not found" });
        return;
      }

      sendJson(res, 404, { error: "not found" });
    })().catch((error) => {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });
}
