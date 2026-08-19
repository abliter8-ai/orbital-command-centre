import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AgentCard } from "@a2a-js/sdk";
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  JsonRpcTransportHandler,
  ServerCallContext,
  type AgentExecutor,
} from "@a2a-js/sdk/server";

export interface A2aHttpOptions {
  card: AgentCard;
  executor: AgentExecutor;
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
 * The JSON-RPC core of one agent, for hosts that do their own HTTP routing
 * (the control-plane daemon mounts one of these per agent).
 */
export function createAgentRpcHandler(options: A2aHttpOptions): AgentRpcHandler {
  const requestHandler = new DefaultRequestHandler(
    options.card,
    new InMemoryTaskStore(),
    options.executor,
  );
  const transport = new JsonRpcTransportHandler(requestHandler);
  return async (body: string) => {
    const result = await transport.handle(body, new ServerCallContext());
    if (result && typeof (result as AsyncGenerator).next === "function") {
      return {
        jsonrpc: "2.0",
        error: { code: -32601, message: "Streaming is not supported by this agent." },
      };
    }
    return result;
  };
}

/**
 * Minimal A2A HTTP hosting: agent card on the well-known paths, JSON-RPC on
 * POST /. Streaming is not advertised (OCC handles are non-streaming), so
 * message/stream is rejected rather than SSE'd.
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
        sendJson(res, 200, await rpc(await readBody(req)));
        return;
      }
      sendJson(res, 404, { error: "not found" });
    })().catch((error) => {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });
}
