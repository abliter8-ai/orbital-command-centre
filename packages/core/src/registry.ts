import type { AgentHandle, AgentId } from "./types.js";

export class UnknownAgentError extends Error {
  readonly agentId: string;
  readonly knownIds: string[];

  constructor(agentId: string, knownIds: string[]) {
    const known = knownIds.length > 0 ? knownIds.join(", ") : "(none registered)";
    super(`Unknown agent id: ${agentId}. Known ids: ${known}`);
    this.name = "UnknownAgentError";
    this.agentId = agentId;
    this.knownIds = knownIds;
  }
}

export class AgentRegistry {
  private readonly handles = new Map<AgentId, AgentHandle>();

  register(handle: AgentHandle): void {
    this.handles.set(handle.agentId, handle);
  }

  get(agentId: AgentId): AgentHandle {
    const handle = this.handles.get(agentId);
    if (!handle) {
      throw new UnknownAgentError(agentId, this.list().map((item) => item.agentId));
    }
    return handle;
  }

  list(): AgentHandle[] {
    return [...this.handles.values()];
  }
}
