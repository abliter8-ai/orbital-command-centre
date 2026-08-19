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
  readonly agentId: AgentId = "codex";
  readonly displayName = "Fake Codex";

  readonly prompts: FakePromptCall[] = [];
  cancelledTaskIds: string[] = [];
  closedSessionIds: string[] = [];

  available = true;
  authenticated = true;
  canned: DelegationResult;

  constructor(overrides: Partial<DelegationResult> = {}) {
    this.canned = {
      taskId: newTaskId(),
      sessionId: "fake-session",
      agentId: "codex",
      status: "succeeded",
      cwd: "/tmp/occ-fake",
      summary: "Fake Codex completed the brief.",
      output: "Fake Codex completed the brief.",
      filesChanged: [],
      durationMs: 12,
      ...overrides,
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
        ? "Fake Codex is injected for tests."
        : "Fake Codex marked unavailable.",
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
