import { CodexAgentHandle } from "@occ/adapter-codex";
import { CursorAgentHandle } from "@occ/adapter-cursor";
import { AgentRegistry, InMemoryTaskStore } from "@occ/core";
import { FastMCP } from "@prefecthq/fastmcp-ts/server";
import { z } from "zod";
import { formatDelegationMarkdown } from "./format.js";
import {
  DELEGATE_TO_CODEX_DESCRIPTION,
  DELEGATE_TO_CURSOR_DESCRIPTION,
  runDelegate,
  runHealth,
} from "./tools.js";

export interface OccServerDeps {
  registry: AgentRegistry;
  store: InMemoryTaskStore;
}

const delegateInput = {
  brief: z
    .string()
    .min(1)
    .describe("Self-contained brief: goal, constraints, files in play, definition of done."),
  cwd: z
    .string()
    .optional()
    .describe("Working directory. Defaults to the MCP server process cwd."),
  model: z.string().optional().describe("Optional model override."),
  sandbox: z
    .enum(["read-only", "workspace-write", "danger-full-access"])
    .optional()
    .describe("Write fence. Default workspace-write."),
  resume_session_id: z
    .string()
    .optional()
    .describe("Session/thread id from a previous delegation."),
  timeout_ms: z
    .number()
    .int()
    .min(1_000)
    .max(1_800_000)
    .optional()
    .describe("Timeout in milliseconds. Default 600000, max 1800000."),
};

export function createDefaultDeps(): OccServerDeps {
  const registry = new AgentRegistry();
  const store = new InMemoryTaskStore();
  registry.register(new CodexAgentHandle(store));
  registry.register(new CursorAgentHandle(store));
  return { registry, store };
}

export function createOccServer(deps: OccServerDeps = createDefaultDeps()): FastMCP {
  const server = new FastMCP({
    name: "orbital-command-centre",
    version: "0.1.0",
  });

  server.tool(
    {
      name: "occ_health",
      description:
        "Check whether OCC can see registered agent CLIs (Codex and Cursor). Call this before delegating.",
      input: z.object({}),
    },
    async () => runHealth(deps.registry),
  );

  server.tool(
    {
      name: "delegate_to_codex",
      description: DELEGATE_TO_CODEX_DESCRIPTION,
      input: z.object(delegateInput),
    },
    async (input) => {
      const result = await runDelegate(deps.registry, deps.store, "codex", input);
      return { ...result, markdown: formatDelegationMarkdown(result) };
    },
  );

  server.tool(
    {
      name: "delegate_to_cursor",
      description: DELEGATE_TO_CURSOR_DESCRIPTION,
      input: z.object(delegateInput),
    },
    async (input) => {
      const result = await runDelegate(deps.registry, deps.store, "cursor", input);
      return { ...result, markdown: formatDelegationMarkdown(result) };
    },
  );

  return server;
}
