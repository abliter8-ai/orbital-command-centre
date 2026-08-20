import { AntigravityAgentHandle } from "@occ/adapter-antigravity";
import { CodexAgentHandle } from "@occ/adapter-codex";
import { CursorAgentHandle } from "@occ/adapter-cursor";
import { GrokAgentHandle } from "@occ/adapter-grok";
import { AgentRegistry, InMemoryTaskStore } from "@occ/core";
import { FastMCP } from "@prefecthq/fastmcp-ts/server";
import { z } from "zod";
import { extractSavedPaths } from "@occ/adapter-grok";
import { loadCatalog, type ModelCatalog } from "./catalog.js";
import { nativeCapabilities } from "./capabilities.js";
import { formatDelegationMarkdown } from "./format.js";
import {
  buildDelegateDescriptions,
  runAgyResearch,
  runCancel,
  runCodexReview,
  runDelegate,
  runGrokImagine,
  runGrokVideo,
  runGrokXSearch,
  runHealth,
  runListTasks,
  runModels,
} from "./tools.js";

export interface OccServerDeps {
  registry: AgentRegistry;
  store: InMemoryTaskStore;
}

export interface OccServerOptions {
  /** Override the model catalog (tests). Defaults to loadCatalog() from disk. */
  catalog?: ModelCatalog;
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
      "Codex model slug. Omit to use ~/.codex/config.toml. Pass only slugs listed in this tool's Models section or by occ_models.",
    ),
  effort: z
    .enum(["low", "medium", "high", "xhigh", "max"])
    .optional()
    .describe(
      "Reasoning effort → Codex model_reasoning_effort. Omit for config default (medium). low=fast, medium=everyday, high=complex, xhigh=extra high, max=hardest single-task. Ultra (subagents) is not this field.",
    ),
  images: z
    .array(z.string())
    .optional()
    .describe(
      "Absolute paths to images Codex should look at (codex exec -i). Screenshots, mockups, error dialogs. Max 4.",
    ),
};

const cursorDelegateInput = {
  ...sharedDelegateInput,
  model: z
    .string()
    .optional()
    .describe(
      "Cursor --model. Omit for auto (CLI default). Pass only slugs listed in this tool's Models section or by occ_models. Optional parameterized form: name[context=1m,effort=high,fast=false].",
    ),
};

const grokDelegateInput = {
  ...sharedDelegateInput,
  model: z
    .string()
    .optional()
    .describe(
      "Grok -m slug. Omit for the CLI default. Pass only slugs listed in this tool's Models section or by occ_models.",
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
      "agy --model slug. Unknown slug is a hard ERROR — pass only slugs listed in this tool's Models section or by occ_models.",
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

export function createOccServer(
  deps: OccServerDeps = createDefaultDeps(),
  options: OccServerOptions = {},
): FastMCP {
  const catalog = options.catalog ?? loadCatalog();
  const descriptions = buildDelegateDescriptions(catalog);

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
      name: "occ_models",
      description:
        "Show the model catalog OCC uses for delegation: live-probed slugs per agent, defaults, catalog age and staleness. Call this to pick a model, or after scripts/update-models to confirm the refresh.",
      input: z.object({}),
    },
    async () => runModels(catalog),
  );

  server.tool(
    {
      name: "occ_tasks",
      description:
        "List delegation tasks known to this server (newest first), including running ones. Use the taskId with occ_cancel. The store is in-memory: history resets when the MCP server restarts.",
      input: z.object({
        status: z
          .array(z.enum(["queued", "running", "succeeded", "failed", "cancelled"]))
          .optional()
          .describe("Filter by status, e.g. [\"running\"] to find cancellable tasks."),
      }),
    },
    async (input) => runListTasks(deps.store, { status: input.status }),
  );

  server.tool(
    {
      name: "occ_cancel",
      description:
        "Cancel a queued or running delegation by taskId (from occ_tasks). Sends SIGTERM to the agent's whole process group, escalating to SIGKILL after a short grace period. The in-flight delegate call returns status cancelled.",
      input: z.object({
        task_id: z.string().min(1).describe("Task id from occ_tasks or a delegate result."),
      }),
    },
    async (input) => runCancel(deps.registry, deps.store, input.task_id),
  );

  server.tool(
    {
      name: "occ_capabilities",
      description:
        "Which native tools each agent has (Grok live X search + Imagine media, Antigravity google_search/read_url/browser, Cursor plan mode + model catalog, Codex sandboxed code work) and how to reach them — first-class OCC tool or brief recipe. Call this when deciding which agent fits a job.",
      input: z.object({}),
    },
    async () => ({ agents: nativeCapabilities() }),
  );

  const grokNativeShared = {
    cwd: z
      .string()
      .optional()
      .describe("Working directory for the run; media lands under here. Defaults to the server cwd."),
    model: z.string().optional().describe("Grok -m slug from occ_models. Omit for the CLI default."),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
    timeout_ms: z.number().int().min(1_000).max(1_800_000).optional(),
  };

  server.tool(
    {
      name: "grok_x_search",
      description:
        "Search live X posts through Grok's native X tools (x_keyword_search / x_semantic_search) — the real X index, not a web scrape of x.com. Max 10 posts per call; for more, resume the session or narrow the window. Returns date/URL/gist per post. For a full thread afterwards, use delegate_to_grok with the post id.",
      input: z.object({
        query: z
          .string()
          .min(1)
          .describe(
            "Keyword operators (from:user, since:YYYY-MM-DD, OR, \"exact phrase\", -filter:replies) or, with semantic=true, a plain-language description.",
          ),
        mode: z.enum(["Latest", "Top"]).optional().describe("Latest = recency (default), Top = engagement."),
        from_user: z.string().optional().describe("Restrict to one X handle, without @ (e.g. AnthropicAI)."),
        window_days: z.number().int().min(1).max(30).optional().describe("Recency window. Default 7."),
        limit: z.number().int().min(1).max(10).optional().describe("Posts to return. Max 10 (tool ceiling)."),
        semantic: z.boolean().optional().describe("Meaning-based retrieval instead of keyword operators."),
        exclude_replies: z.boolean().optional().describe("Original posts only (keyword mode)."),
        ...grokNativeShared,
      }),
    },
    async (input) => {
      const result = await runGrokXSearch(deps.registry, deps.store, {
        query: input.query,
        cwd: input.cwd ?? process.cwd(),
        mode: input.mode,
        fromUser: input.from_user,
        windowDays: input.window_days,
        limit: input.limit,
        semantic: input.semantic,
        excludeReplies: input.exclude_replies,
        model: input.model,
        effort: input.effort,
        timeoutMs: input.timeout_ms,
      });
      return { ...result, markdown: formatDelegationMarkdown(result) };
    },
  );

  server.tool(
    {
      name: "grok_imagine",
      description:
        "Generate or edit a still image through Grok's Imagine tools (image_gen / image_edit). For photos, illustrations, characters, scenes — not charts, diagrams, or UI with real copy (build those in code). Returns the saved absolute path in mediaPaths; if mediaSaved is false, generation failed — read output for the reason. Pass source_image to edit an existing image instead of generating.",
      input: z.object({
        prompt: z
          .string()
          .min(1)
          .describe("Visual prompt: subject → setting → style → lighting. Prose, 2–5 sentences, no tag salad."),
        aspect_ratio: z.enum(["1:1", "16:9", "9:16", "3:2", "2:3"]).optional(),
        source_image: z
          .string()
          .optional()
          .describe("Absolute path (or HTTPS/data URL) of the image to edit. Omit to generate from scratch."),
        keep_from_source: z
          .string()
          .optional()
          .describe("For edits: what must stay the same (face, composition, …)."),
        ...grokNativeShared,
      }),
    },
    async (input) => {
      const result = await runGrokImagine(deps.registry, deps.store, {
        prompt: input.prompt,
        cwd: input.cwd ?? process.cwd(),
        aspectRatio: input.aspect_ratio,
        sourceImage: input.source_image,
        keepFromSource: input.keep_from_source,
        model: input.model,
        effort: input.effort,
        timeoutMs: input.timeout_ms,
      });
      const mediaPaths = extractSavedPaths(result.output);
      return {
        ...result,
        mediaPaths,
        mediaSaved: mediaPaths.length > 0,
        markdown: formatDelegationMarkdown(result),
      };
    },
  );

  server.tool(
    {
      name: "grok_video",
      description:
        "Animate a still image into a short video through Grok's image_to_video. There is no text-to-video: stage frame 1 first (grok_imagine or an existing file), then animate. One moment, one camera move. Returns the saved absolute path in mediaPaths. If mediaSaved is false, generation failed — read output for the reason (e.g. Zero Data Retention accounts must supply an upload URL the CLI does not expose).",
      input: z.object({
        source_image: z.string().min(1).describe("Absolute path to frame 1 (from grok_imagine or on disk)."),
        prompt: z
          .string()
          .optional()
          .describe("Motion brief: one present-tense moment, one camera move, 1–2 sentences."),
        duration: z.union([z.literal(6), z.literal(10)]).optional().describe("Seconds. Default 6."),
        resolution: z.enum(["480p", "720p"]).optional().describe("Default 480p; 720p only when asked."),
        max_turns: z.number().int().min(2).max(20).optional().describe("Tool-loop cap. Default 8."),
        ...grokNativeShared,
      }),
    },
    async (input) => {
      const result = await runGrokVideo(deps.registry, deps.store, {
        sourceImage: input.source_image,
        cwd: input.cwd ?? process.cwd(),
        prompt: input.prompt,
        duration: input.duration,
        resolution: input.resolution,
        maxTurns: input.max_turns,
        model: input.model,
        effort: input.effort,
        timeoutMs: input.timeout_ms,
      });
      const mediaPaths = extractSavedPaths(result.output);
      return {
        ...result,
        mediaPaths,
        mediaSaved: mediaPaths.length > 0,
        markdown: formatDelegationMarkdown(result),
      };
    },
  );

  server.tool(
    {
      name: "codex_review",
      description:
        "Run Codex's first-class code review (codex exec review) against a repo: uncommitted changes, a diff vs a base branch, a single commit, or a custom review prompt. Always read-only. Returns the review findings as the output. Use this instead of delegate_to_codex when the job is reviewing changes, not making them.",
      input: z.object({
        target: z
          .enum(["uncommitted", "base", "commit", "custom"])
          .describe(
            "What to review: uncommitted = staged+unstaged+untracked; base = diff vs a branch; commit = one SHA; custom = only your prompt.",
          ),
        ref: z
          .string()
          .optional()
          .describe("Branch name when target=base, SHA when target=commit."),
        prompt: z
          .string()
          .optional()
          .describe(
            "Custom review instructions. Only used with target=custom — the CLI forbids mixing a prompt with uncommitted/base/commit.",
          ),
        cwd: z
          .string()
          .optional()
          .describe("Repo to review. Defaults to the MCP server process cwd."),
        model: z.string().optional().describe("Codex model slug from occ_models. Omit for config default."),
        effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
        timeout_ms: z.number().int().min(1_000).max(1_800_000).optional(),
      }),
    },
    async (input) => {
      const target =
        input.target === "base"
          ? { kind: "base" as const, branch: input.ref ?? "main" }
          : input.target === "commit"
            ? { kind: "commit" as const, sha: input.ref ?? "HEAD" }
            : input.target === "custom"
              ? { kind: "custom" as const }
              : { kind: "uncommitted" as const };
      const result = await runCodexReview(deps.registry, deps.store, {
        target,
        prompt: input.prompt,
        cwd: input.cwd ?? process.cwd(),
        model: input.model,
        effort: input.effort,
        timeoutMs: input.timeout_ms,
      });
      return { ...result, markdown: formatDelegationMarkdown(result) };
    },
  );

  server.tool(
    {
      name: "antigravity_research",
      description:
        "Web research through Antigravity's native google_search + read_url (the real Google index, grounded). Pre-flight checks ~/.gemini/antigravity-cli/settings.json for the read_url allow rule headless runs need: 'check' (default) fails fast with the exact fix, 'fix' adds the rule (timestamped backup), 'skip' runs blind. Returns findings with source URLs.",
      input: z.object({
        question: z.string().min(1).describe("The research question, self-contained."),
        fetch_pages: z
          .array(z.string())
          .optional()
          .describe("Specific URLs to read in full, in addition to search."),
        subagents: z
          .boolean()
          .optional()
          .describe("Let agy spawn subagents for parallel sub-questions."),
        preflight: z
          .enum(["check", "fix", "skip"])
          .optional()
          .describe("Permission pre-flight for read_url(*). Default check."),
        cwd: z.string().optional().describe("Working directory. Defaults to the server cwd."),
        model: z.string().optional().describe("agy --model slug from occ_models. Unknown slug is a hard ERROR."),
        effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
        timeout_ms: z.number().int().min(1_000).max(1_800_000).optional(),
      }),
    },
    async (input) => {
      const result = await runAgyResearch(deps.registry, deps.store, {
        question: input.question,
        fetchPages: input.fetch_pages,
        subagents: input.subagents,
        preflight: input.preflight,
        cwd: input.cwd ?? process.cwd(),
        model: input.model,
        effort: input.effort,
        timeoutMs: input.timeout_ms,
      });
      return { ...result, markdown: formatDelegationMarkdown(result) };
    },
  );

  server.tool(
    {
      name: "delegate_to_codex",
      description: descriptions.codex,
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
      description: descriptions.cursor,
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
      description: descriptions.grok,
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
      description: descriptions.antigravity,
      input: z.object(antigravityDelegateInput),
    },
    async (input) => {
      const result = await runDelegate(deps.registry, deps.store, "antigravity", input);
      return { ...result, markdown: formatDelegationMarkdown(result) };
    },
  );

  return server;
}
