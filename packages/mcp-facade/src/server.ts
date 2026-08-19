import { AntigravityAgentHandle } from "@occ/adapter-antigravity";
import { CodexAgentHandle } from "@occ/adapter-codex";
import { CursorAgentHandle } from "@occ/adapter-cursor";
import { GrokAgentHandle } from "@occ/adapter-grok";
import { AgentRegistry, InMemoryTaskStore } from "@occ/core";
import { FastMCP } from "@prefecthq/fastmcp-ts/server";
import { z } from "zod";
import { formatDelegationMarkdown } from "./format.js";
import {
  DELEGATE_TO_ANTIGRAVITY_DESCRIPTION,
  DELEGATE_TO_CODEX_DESCRIPTION,
  DELEGATE_TO_CURSOR_DESCRIPTION,
  DELEGATE_TO_GROK_DESCRIPTION,
  runDelegate,
  runHealth,
} from "./tools.js";

export interface OccServerDeps {
  registry: AgentRegistry;
  store: InMemoryTaskStore;
}

const sharedDelegateInput = {
  brief: z
    .string()
    .min(1)
    .describe("Self-contained brief: goal, constraints, files in play, definition of done."),
  cwd: z
    .string()
    .optional()
    .describe("Working directory. Defaults to the MCP server process cwd."),
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

const codexDelegateInput = {
  ...sharedDelegateInput,
  model: z
    .string()
    .optional()
    .describe(
      "Codex model slug. Omit to use ~/.codex/config.toml (currently gpt-5.6-luna on this machine). Recommended: gpt-5.6-sol (flagship), gpt-5.6-terra (everyday), gpt-5.6-luna (fast/cheap), gpt-5.6 (alias→sol), gpt-5.5 (previous gen). Avoid gpt-5.1-codex / gpt-5.3-codex on ChatGPT auth.",
    ),
  effort: z
    .enum(["low", "medium", "high", "xhigh", "max"])
    .optional()
    .describe(
      "Reasoning effort → Codex model_reasoning_effort. Omit for config default (medium). low=fast, medium=everyday, high=complex, xhigh=extra high, max=hardest single-task. Ultra (subagents) is not this field.",
    ),
};

const cursorDelegateInput = {
  ...sharedDelegateInput,
  model: z
    .string()
    .optional()
    .describe(
      "Cursor --model. Omit for auto (CLI default). Verified slugs: auto, gpt-5, sonnet-4-thinking. Optional parameterized form: name[context=1m,effort=high,fast=false] e.g. claude-opus-4-8[effort=high]. Not a Codex slug. Not an ACP desktop modelId.",
    ),
};

const grokDelegateInput = {
  ...sharedDelegateInput,
  model: z
    .string()
    .optional()
    .describe(
      "Grok -m slug. Omit for grok-4.6 (CLI default). grok-4.5 is previous gen. Local aliases only if occ_health listed them. Not a Codex or Cursor slug.",
    ),
  effort: z
    .enum(["low", "medium", "high", "xhigh", "max"])
    .optional()
    .describe(
      "Reasoning effort → grok --effort. Omit for Grok default. low=fast, medium=everyday, high=complex, xhigh=extra high, max=hardest single-task.",
    ),
};

const antigravityDelegateInput = {
  ...sharedDelegateInput,
  model: z
    .string()
    .optional()
    .describe(
      "agy --model slug from `agy models`. e.g. gemini-3.7-flash-high, gemini-3.5-flash-medium, gemini-3.1-pro-high, claude-sonnet-4-6. Unknown slug is a hard ERROR. Not a Codex or Grok slug.",
    ),
  effort: z
    .enum(["low", "medium", "high", "xhigh", "max"])
    .optional()
    .describe(
      "Reasoning effort → agy --effort (low|medium|high). OCC xhigh/max map to high.",
    ),
};

export function createDefaultDeps(): OccServerDeps {
  const registry = new AgentRegistry();
  const store = new InMemoryTaskStore();
  registry.register(new CodexAgentHandle(store));
  registry.register(new CursorAgentHandle(store));
  registry.register(new GrokAgentHandle(store));
  registry.register(new AntigravityAgentHandle(store));
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
        "Check whether OCC can see registered agent CLIs (Codex, Cursor, Grok, Antigravity). Call this before delegating.",
      input: z.object({}),
    },
    async () => runHealth(deps.registry),
  );

  server.tool(
    {
      name: "delegate_to_codex",
      description: DELEGATE_TO_CODEX_DESCRIPTION,
      input: z.object(codexDelegateInput),
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
      input: z.object(cursorDelegateInput),
    },
    async (input) => {
      const result = await runDelegate(deps.registry, deps.store, "cursor", input);
      return { ...result, markdown: formatDelegationMarkdown(result) };
    },
  );

  server.tool(
    {
      name: "delegate_to_grok",
      description: DELEGATE_TO_GROK_DESCRIPTION,
      input: z.object(grokDelegateInput),
    },
    async (input) => {
      const result = await runDelegate(deps.registry, deps.store, "grok", input);
      return { ...result, markdown: formatDelegationMarkdown(result) };
    },
  );

  server.tool(
    {
      name: "delegate_to_antigravity",
      description: DELEGATE_TO_ANTIGRAVITY_DESCRIPTION,
      input: z.object(antigravityDelegateInput),
    },
    async (input) => {
      const result = await runDelegate(deps.registry, deps.store, "antigravity", input);
      return { ...result, markdown: formatDelegationMarkdown(result) };
    },
  );

  return server;
}
