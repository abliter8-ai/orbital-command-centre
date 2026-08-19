import { newTaskId } from "./ids.js";
import type {
  AgentId,
  DelegationResult,
  PromptRequest,
  TaskStatus,
} from "./types.js";

export interface TaskRecord {
  taskId: string;
  sessionId: string;
  agentId: AgentId;
  status: TaskStatus;
  request: PromptRequest;
  result?: DelegationResult;
  startedAt: string;
  finishedAt?: string;
}

export class UnknownTaskError extends Error {
  readonly taskId: string;

  constructor(taskId: string) {
    super(`Unknown task id: ${taskId}`);
    this.name = "UnknownTaskError";
    this.taskId = taskId;
  }
}

export class InMemoryTaskStore {
  private readonly tasks = new Map<string, TaskRecord>();

  create(input: {
    sessionId: string;
    agentId: AgentId;
    request: PromptRequest;
  }): TaskRecord {
    const record: TaskRecord = {
      taskId: newTaskId(),
      sessionId: input.sessionId,
      agentId: input.agentId,
      status: "queued",
      request: input.request,
      startedAt: new Date().toISOString(),
    };
    this.tasks.set(record.taskId, record);
    return { ...record };
  }

  markRunning(taskId: string): TaskRecord {
    const record = this.require(taskId);
    record.status = "running";
    return { ...record };
  }

  complete(taskId: string, result: DelegationResult): TaskRecord {
    const record = this.require(taskId);
    record.status = result.status;
    record.result = result;
    record.finishedAt = new Date().toISOString();
    return { ...record, result };
  }

  record(result: DelegationResult, request: PromptRequest): TaskRecord {
    const record: TaskRecord = {
      taskId: result.taskId,
      sessionId: result.sessionId,
      agentId: result.agentId,
      status: result.status,
      request,
      result,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
    this.tasks.set(record.taskId, record);
    return { ...record };
  }

  cancel(taskId: string): TaskRecord {
    const record = this.require(taskId);
    record.status = "cancelled";
    record.finishedAt = new Date().toISOString();
    return { ...record };
  }

  get(taskId: string): TaskRecord | undefined {
    const record = this.tasks.get(taskId);
    return record ? { ...record } : undefined;
  }

  private require(taskId: string): TaskRecord {
    const record = this.tasks.get(taskId);
    if (!record) {
      throw new UnknownTaskError(taskId);
    }
    return record;
  }
}
