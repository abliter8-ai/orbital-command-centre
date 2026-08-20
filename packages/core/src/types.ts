export type AgentId = "codex" | "cursor" | "grok" | "antigravity" | "claude";

export type TaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentCapabilities {
  streaming: boolean;
  resume: boolean;
  cancel: boolean;
  sandboxModes: SandboxMode[];
}

export interface Availability {
  available: boolean;
  authenticated: boolean;
  detail: string;
  version?: string;
}

export interface Session {
  sessionId: string;
  agentId: AgentId;
  cwd: string;
  createdAt: string;
}

export interface SessionOptions {
  cwd: string;
  resumeSessionId?: string;
  model?: string;
}

/**
 * Incremental progress from a running delegation. Event-level, not
 * token-level: adapters emit what their CLI's stream actually carries
 * (assistant messages as they complete, tool call starts/ends).
 */
export interface StreamEvent {
  kind: "text" | "tool_start" | "tool_end";
  /** text: the assistant text chunk. tool_*: short tool label. */
  text: string;
}

export interface PromptRequest {
  brief: string;
  sandbox?: SandboxMode;
  timeoutMs?: number;
  effort?: ReasoningEffort;
  /** Absolute paths to images for the agent to look at. Adapters that cannot accept image input ignore this. */
  images?: string[];
  /**
   * Called as the delegation produces incremental output. Only invoked by
   * adapters whose capabilities() report streaming: true.
   */
  onEvent?: (event: StreamEvent) => void;
}

export interface FileChange {
  path: string;
  change: "add" | "mod" | "del" | "unknown";
}

export interface DelegationError {
  code:
    | "not_available"
    | "not_authenticated"
    | "invalid_cwd"
    | "timeout"
    | "cancelled"
    | "spawn_failed"
    | "agent_failed"
    | "parse_failed";
  message: string;
  hint?: string;
}

export interface DelegationResult {
  taskId: string;
  sessionId: string;
  agentId: AgentId;
  status: TaskStatus;
  cwd: string;
  summary: string;
  output: string;
  filesChanged: FileChange[];
  diffStat?: string;
  durationMs: number;
  usage?: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
  };
  error?: DelegationError;
}

export interface AgentHandle {
  readonly agentId: AgentId;
  readonly displayName: string;
  capabilities(): AgentCapabilities;
  isAvailable(): Promise<Availability>;
  startSession(opts: SessionOptions): Promise<Session>;
  prompt(session: Session, request: PromptRequest): Promise<DelegationResult>;
  cancel(taskId: string): Promise<void>;
  close(session: Session): Promise<void>;
}
