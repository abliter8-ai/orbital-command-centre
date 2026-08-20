import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AgentCard } from "@a2a-js/sdk";
import {
  DefaultRequestHandler,
  JsonRpcTransportHandler,
  ServerCallContext,
  type AgentExecutor,
} from "@a2a-js/sdk/server";
import { FileTaskStore, NormalizedTaskStore } from "./stores.js";

export interface A2aHttpOptions {
  card: AgentCard;
  executor: AgentExecutor;
  /**
   * When set, tasks persist to this JSON file (atomic writes, hydrated on
   * boot) so they survive a server crash or restart. Unset: in-memory only.
   */
  taskStorePath?: string;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export type AgentRpcHandler = (body: string) => Promise<unknown>;

/**
 * The spec's JSON convention is "user"/"agent" for message roles, but the
 * SDK's proto parser only accepts "ROLE_USER"/"ROLE_AGENT" and silently maps
 * anything else to UNRECOGNIZED. Normalize inbound roles so spec-conformant
 * clients get clean history semantics.
 */
function normalizeRequestBody(body: string): string {
  let parsed: { method?: string; params?: { message?: { role?: unknown } } };
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    return body;
  }
  const message = parsed?.params?.message;
  if (!message || typeof message.role !== "string") return body;
  const role = message.role.toLowerCase();
  if (role !== "user" && role !== "agent") return body;
  message.role = `ROLE_${role.toUpperCase()}`;
  return JSON.stringify(parsed);
}

/**
 * The JSON-RPC core of one agent, for hosts that do their own HTTP routing
 * (the control-plane daemon mounts one of these per agent). Streaming methods
 * (message/stream) resolve to an AsyncGenerator — hosts must write it with
 * writeRpcResult, which emits SSE.
 */
export function createAgentRpcHandler(options: A2aHttpOptions): AgentRpcHandler {
  const requestHandler = new DefaultRequestHandler(
    options.card,
    options.taskStorePath ? new FileTaskStore(options.taskStorePath) : new NormalizedTaskStore(),
    options.executor,
  );
  const transport = new JsonRpcTransportHandler(requestHandler);
  return (body: string) =>
    transport.handle(normalizeRequestBody(body), new ServerCallContext()) as Promise<unknown>;
}

function isAsyncGenerator(value: unknown): value is AsyncGenerator<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AsyncGenerator).next === "function"
  );
}

/**
 * Write a JSON-RPC result onto an HTTP response. Plain results go as JSON;
 * async generators (message/stream) go as Server-Sent Events, one `data:`
 * frame per event, closed when the generator finishes or the client drops.
 */
export async function writeRpcResult(res: ServerResponse, result: unknown): Promise<void> {
  if (!isAsyncGenerator(result)) {
    sendJson(res, 200, result);
    return;
  }
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.on("close", () => {
    void result.return(undefined);
  });
  try {
    for await (const event of result) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  } catch (error) {
    res.write(
      `data: ${JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
      })}\n\n`,
    );
  }
  res.end();
}

/**
 * Minimal A2A HTTP hosting: agent card on the well-known paths, JSON-RPC on
 * POST /. message/stream is served as SSE when the underlying handle streams
 * (codex, cursor); buffered handles simply deliver their events at the end.
 */
export function createA2aHttpServer(options: A2aHttpOptions): Server {
  const rpc = createAgentRpcHandler(options);

  return createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" &&
          (url.pathname === "/.well-known/agent-card.json" || url.pathname === "/.well-known/agent.json")) {
        sendJson(res, 200, options.card);
        return;
      }
      if (req.method === "POST" && (url.pathname === "/" || url.pathname === "/rpc")) {
        await writeRpcResult(res, await rpc(await readBody(req)));
        return;
      }
      sendJson(res, 404, { error: "not found" });
    })().catch((error) => {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });
}
