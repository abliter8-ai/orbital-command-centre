import { newPendingSessionId, newTaskId } from "./ids.js";
import type {
  AgentCapabilities,
  AgentHandle,
  AgentId,
  Availability,
  DelegationResult,
  PromptRequest,
  Session,
  SessionOptions,
} from "./types.js";

export interface FakePromptCall {
  session: Session;
  request: PromptRequest;
}

export class FakeAgentHandle implements AgentHandle {
  readonly agentId: AgentId;
  readonly displayName: string;

  readonly prompts: FakePromptCall[] = [];
  cancelledTaskIds: string[] = [];
  closedSessionIds: string[] = [];

  available = true;
  authenticated = true;
  canned: DelegationResult;

  constructor(overrides: Partial<DelegationResult> = {}) {
    this.agentId = overrides.agentId ?? "codex";
    this.displayName =
      this.agentId === "cursor"
        ? "Fake Cursor"
        : this.agentId === "grok"
          ? "Fake Grok"
          : "Fake Codex";
    this.canned = {
      taskId: newTaskId(),
      sessionId: "fake-session",
      status: "succeeded",
      cwd: "/tmp/occ-fake",
      summary: `${this.displayName} completed the brief.`,
      output: `${this.displayName} completed the brief.`,
      filesChanged: [],
      durationMs: 12,
      ...overrides,
      agentId: this.agentId,
    };
  }

  capabilities(): AgentCapabilities {
    return {
      streaming: false,
      resume: true,
      cancel: true,
      sandboxModes: ["read-only", "workspace-write", "danger-full-access"],
    };
  }

  async isAvailable(): Promise<Availability> {
    return {
      available: this.available,
      authenticated: this.authenticated,
      detail: this.available
        ? `${this.displayName} is injected for tests.`
        : `${this.displayName} marked unavailable.`,
      version: "fake-0",
    };
  }

  async startSession(opts: SessionOptions): Promise<Session> {
    return {
      sessionId: opts.resumeSessionId ?? newPendingSessionId(),
      agentId: this.agentId,
      cwd: opts.cwd,
      createdAt: new Date().toISOString(),
    };
  }

  async prompt(session: Session, request: PromptRequest): Promise<DelegationResult> {
    this.prompts.push({ session, request });
    return {
      ...this.canned,
      sessionId:
        this.canned.sessionId === "fake-session" ? session.sessionId : this.canned.sessionId,
      cwd: session.cwd,
    };
  }

  async cancel(taskId: string): Promise<void> {
    this.cancelledTaskIds.push(taskId);
  }

  async close(session: Session): Promise<void> {
    this.closedSessionIds.push(session.sessionId);
  }
}
