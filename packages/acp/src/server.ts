import * as acp from "@agentclientprotocol/sdk";
import type {
  AgentHandle,
  DelegationResult,
  InMemoryTaskStore,
  ReasoningEffort,
  SandboxMode,
  Session,
} from "@occ/core";

const SANDBOX_MODES: { id: SandboxMode; name: string; description: string }[] = [
  { id: "read-only", name: "Read only", description: "Investigate and answer; no file edits." },
  { id: "workspace-write", name: "Workspace write", description: "May edit files in the workspace." },
  {
    id: "danger-full-access",
    name: "Full access",
    description: "No approval prompts; trusted workspaces only.",
  },
];

const DEFAULT_MODE: SandboxMode = "workspace-write";

interface OccSessionState {
  session: Session;
  mode: SandboxMode;
  currentTaskId?: string;
}

export interface OccAcpAgentOptions {
  handle: AgentHandle;
  /**
   * The store the handle writes task records into. Used to route
   * session/cancel to the in-flight task. Must be the same instance the
   * handle was constructed with.
   */
  store: InMemoryTaskStore;
  /** Default model for sessions; overridable per session via _meta.model. */
  model?: string;
  effort?: ReasoningEffort;
  /** agentInfo reported on initialize. */
  name?: string;
  version?: string;
}

/**
 * Exposes one OCC AgentHandle as an ACP agent (Zed-style editor integration).
 * ACP session modes map onto OCC sandbox modes. Handles are non-streaming, so
 * the turn emits a pending tool_call while the delegation runs and the result
 * lands as a single agent_message_chunk.
 */
export class OccAcpAgent {
  private readonly handle: AgentHandle;
  private readonly defaults: OccAcpAgentOptions;
  private readonly sessions = new Map<string, OccSessionState>();

  constructor(options: OccAcpAgentOptions) {
    this.handle = options.handle;
    this.defaults = options;
  }

  async initialize(
    _params: acp.InitializeRequest,
  ): Promise<acp.InitializeResponse> {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {
          embeddedContext: true,
          image: false,
          audio: false,
        },
      },
      agentInfo: {
        name: this.defaults.name ?? `occ-${this.handle.agentId}`,
        version: this.defaults.version ?? "0.1.0",
      },
    };
  }

  async authenticate(_params: acp.AuthenticateRequest): Promise<acp.AuthenticateResponse> {
    // The underlying CLIs carry their own local auth; nothing to do per session.
    return {};
  }

  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    const meta = params._meta as { model?: unknown } | null | undefined;
    const model =
      typeof meta?.model === "string" && meta.model.trim() !== ""
        ? meta.model.trim()
        : this.defaults.model;
    const session = await this.handle.startSession({ cwd: params.cwd, model });
    this.sessions.set(session.sessionId, { session, mode: DEFAULT_MODE });
    return {
      sessionId: session.sessionId,
      modes: {
        currentModeId: DEFAULT_MODE,
        availableModes: SANDBOX_MODES.map((mode) => ({ ...mode })),
      },
    };
  }

  async setSessionMode(
    params: acp.SetSessionModeRequest,
  ): Promise<acp.SetSessionModeResponse> {
    const state = this.requireSession(params.sessionId);
    if (!SANDBOX_MODES.some((mode) => mode.id === params.modeId)) {
      throw new Error(
        `Unknown mode "${params.modeId}". Available: ${SANDBOX_MODES.map((m) => m.id).join(", ")}`,
      );
    }
    state.mode = params.modeId as SandboxMode;
    return {};
  }

  async prompt(
    params: acp.PromptRequest,
    client: { notify: (method: string, params: unknown) => Promise<void> },
  ): Promise<acp.PromptResponse> {
    const state = this.requireSession(params.sessionId);
    const brief = promptText(params.prompt);
    if (brief.trim() === "") {
      throw new Error("Prompt contained no text content.");
    }

    const toolCallId = `occ-${Date.now().toString(36)}`;
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId,
        title: `${this.handle.displayName} delegation (${state.mode})`,
        kind: "execute",
        status: "pending",
      },
    });

    let result: DelegationResult;
    try {
      const running = this.handle.prompt(state.session, {
        brief,
        sandbox: state.mode,
        effort: this.defaults.effort,
      });
      // Handles register the task synchronously before their first await, so
      // the running record is already visible for cancel routing.
      state.currentTaskId = this.defaults.store
        .list({ status: ["queued", "running"] })
        .find((task) => task.sessionId === state.session.sessionId)?.taskId;
      result = await running;
      state.currentTaskId = undefined;
    } catch (error) {
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: "failed",
        },
      });
      throw error;
    }

    if (result.status === "cancelled") {
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: "tool_call_update", toolCallId, status: "cancelled" },
      });
      return { stopReason: "cancelled" };
    }

    const ok = result.status === "succeeded";
    const text = ok
      ? result.output || result.summary
      : `${result.error?.message ?? "Delegation failed."}${result.error?.hint ? `\n\nHint: ${result.error.hint}` : ""}`;
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: ok ? "completed" : "failed",
      },
    });
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    });
    return { stopReason: ok ? "end_turn" : "refusal" };
  }

  async cancel(params: acp.CancelNotification): Promise<void> {
    const state = this.sessions.get(params.sessionId);
    if (state?.currentTaskId) {
      await this.handle.cancel(state.currentTaskId);
    }
  }

  /** Track the in-flight task so session/cancel reaches the right process group. */
  noteTaskId(sessionId: string, taskId: string | undefined): void {
    const state = this.sessions.get(sessionId);
    if (state) state.currentTaskId = taskId;
  }

  private requireSession(sessionId: string): OccSessionState {
    const state = this.sessions.get(sessionId);
    if (!state) throw new Error(`Unknown session ${sessionId}`);
    return state;
  }
}

/** Flatten ACP content blocks into brief text. */
export function promptText(blocks: acp.ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      parts.push(block.text);
    } else if (block.type === "resource_link") {
      parts.push(`[context: ${block.uri}${block.name ? ` (${block.name})` : ""}]`);
    } else if (block.type === "resource") {
      const resource = block.resource;
      if ("text" in resource && typeof resource.text === "string") {
        parts.push(resource.text);
      }
    }
  }
  return parts.join("\n");
}
