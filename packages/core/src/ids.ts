import { randomUUID } from "node:crypto";

export function newTaskId(): string {
  return `task_${randomUUID()}`;
}

export function newPendingSessionId(): string {
  return `pending_${randomUUID()}`;
}

export function isPendingSessionId(sessionId: string): boolean {
  return sessionId.startsWith("pending_");
}
