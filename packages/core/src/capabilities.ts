import type { AgentId } from "./types.js";

export interface NativeCapability {
  name: string;
  kind: "search" | "media" | "browser" | "code" | "session";
  summary: string;
  /** How the orchestrator reaches it: an OCC tool name, or "brief" guidance. */
  invoke: string;
  notes?: string;
}

export interface AgentNativeProfile {
  agentId: AgentId;
  differentiator: string;
  nativeTools: NativeCapability[];
  /** When the source-refs this was curated from were captured live. */
  reviewedAt: string;
}

/**
 * Curated from docs/source-refs (live captures, 2026-08-19) — not probed at
 * runtime: the CLIs expose no reliable machine-readable tool listing, and
 * `grok models`-style probes are deliberately kept out of the server process.
 */
export function nativeCapabilities(): Record<AgentId, AgentNativeProfile> {
  return {
    codex: {
      agentId: "codex",
      differentiator:
        "Strongest code implementation ladder (gpt-5.6 sol/terra/luna) on ChatGPT auth; sandboxed shell + file tools.",
      reviewedAt: "2026-08-19",
      nativeTools: [
        {
          name: "sandboxed-shell+files",
          kind: "code",
          summary: "Full repo work inside the Codex sandbox policy.",
          invoke: "delegate_to_codex",
        },
        {
          name: "codex review",
          kind: "code",
          summary: "First-class non-interactive code review: uncommitted / vs base branch / one commit / custom. Always read-only.",
          invoke: "codex_review",
        },
        {
          name: "image-input",
          kind: "media",
          summary: "Attach images to the prompt (codex exec -i): screenshots, mockups, error dialogs.",
          invoke: 'delegate_to_codex with images: ["/abs/path.png"]',
        },
      ],
    },
    cursor: {
      agentId: "cursor",
      differentiator:
        "Widest live model catalog (200+ slugs incl. composer and fast variants); plan mode for read-only analysis.",
      reviewedAt: "2026-08-19",
      nativeTools: [
        {
          name: "plan-mode",
          kind: "code",
          summary: "Read-only planning/analysis (cursor-agent --mode plan/ask).",
          invoke: 'delegate_to_cursor with sandbox "read-only"',
        },
        {
          name: "model-catalog",
          kind: "session",
          summary: "Live 200+ model list incl. parameterized name[context,effort,fast] forms.",
          invoke: "occ_models",
        },
        {
          name: "mcp-client",
          kind: "session",
          summary: "cursor-agent can itself attach MCP servers for the delegated run.",
          invoke: "brief — name the MCP tools the run may use",
        },
      ],
    },
    grok: {
      agentId: "grok",
      differentiator:
        "Only agent with the live X index and Imagine media generation; also open-web search/fetch.",
      reviewedAt: "2026-08-19",
      nativeTools: [
        {
          name: "x_keyword_search",
          kind: "search",
          summary: "Live X posts by operators (from:, since:, filters). Max 10/call.",
          invoke: "grok_x_search",
          notes: "Latest/Top modes; window via last-N-days or since:/until:.",
        },
        {
          name: "x_semantic_search",
          kind: "search",
          summary: "Live X retrieval by meaning, optional usernames/date bounds.",
          invoke: "grok_x_search with semantic: true",
        },
        {
          name: "x_user_search",
          kind: "search",
          summary: "Resolve a name to the right handle before a from: query.",
          invoke: "grok_x_search brief, or delegate_to_grok",
        },
        {
          name: "x_thread_fetch",
          kind: "search",
          summary: "One post plus parent and replies.",
          invoke: "delegate_to_grok — 'Fetch the full X thread for post id <ID>'",
        },
        {
          name: "web_search / web_fetch",
          kind: "search",
          summary: "Indexed open web. Not the live X index.",
          invoke: "delegate_to_grok — name web_search/web_fetch in the brief",
        },
        {
          name: "image_gen / image_edit",
          kind: "media",
          summary: "Imagine stills: new from prompt, or edit a source image.",
          invoke: "grok_imagine",
          notes: "Not for charts/diagrams/UI with real copy — build those in code.",
        },
        {
          name: "image_to_video / reference_to_video",
          kind: "media",
          summary: "Animate a still (6s/10s, 480p/720p). No text-to-video.",
          invoke: "grok_video",
        },
      ],
    },
    antigravity: {
      agentId: "antigravity",
      differentiator:
        "Grounded Google search and optional browser automation; Gemini/Claude/GPT-OSS catalog; subagent fan-out.",
      reviewedAt: "2026-08-19",
      nativeTools: [
        {
          name: "google_search",
          kind: "search",
          summary: "Grounded public web search (the real Google index).",
          invoke: "antigravity_research",
          notes: "First-class tool runs a permission pre-flight (check/fix/skip) for the read_url allow rule.",
        },
        {
          name: "read_url",
          kind: "search",
          summary: "Fetch and process a page (grounded fetch).",
          invoke: "antigravity_research with fetch_pages, or delegate_to_antigravity — name read_url in the brief",
          notes:
            'Default Ask → soft-denied headless. antigravity_research pre-flights this; otherwise pre-allow "read_url(*)" in ~/.gemini/antigravity-cli/settings.json.',
        },
        {
          name: "execute_url (browser)",
          kind: "browser",
          summary: "Drive a live browser: click, type, read rendered DOM.",
          invoke: "delegate_to_antigravity — only with pre-allowed execute_url or danger-full-access",
        },
        {
          name: "subagents",
          kind: "session",
          summary: "Parallel research subagents with web access.",
          invoke: "delegate_to_antigravity — ask for subagent fan-out in the brief",
        },
      ],
    },
    claude: {
      agentId: "claude",
      differentiator:
        "Claude itself as a delegate — the flip that lets Cursor/Codex/Grok orchestrators borrow Claude's reasoning tier, and lets Claude Code fan out second-opinion or parallel work to a clean child.",
      reviewedAt: "2026-08-20",
      nativeTools: [
        {
          name: "web-search+fetch",
          kind: "search",
          summary: "Server-side WebSearch/WebFetch — no local permission rule needed in plan mode.",
          invoke: "delegate_to_claude — name WebSearch/WebFetch in the brief",
        },
        {
          name: "task-subagents",
          kind: "session",
          summary: "The child can fan out its own Task subagents for parallel exploration.",
          invoke: "delegate_to_claude — ask for subagent fan-out in the brief",
        },
        {
          name: "second-opinion-review",
          kind: "code",
          summary: "Same-engine independent review: plan with one agent, critique with a clean-context Claude.",
          invoke: "delegate_to_claude with sandbox read-only",
        },
      ],
    },
  };
}
