import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentId } from "@occ/core";

export interface AuditEntry {
  ts: string;
  agentId: AgentId;
  a2aTaskId: string;
  contextId: string;
  sandbox: string;
  model?: string;
  /** succeeded | failed | cancelled | rejected */
  status: string;
  durationMs: number;
  error?: string;
}

export function auditPath(): string {
  return process.env.OCC_AUDIT_PATH ?? join(homedir(), ".occ", "audit.jsonl");
}

/** Append-only JSONL audit trail of every delegation the daemon mediates. */
export class AuditLog {
  readonly file: string;

  constructor(file: string = auditPath()) {
    this.file = file;
  }

  append(entry: AuditEntry): void {
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, `${JSON.stringify(entry)}\n`, "utf8");
  }

  read(limit = 50): AuditEntry[] {
    let text: string;
    try {
      text = readFileSync(this.file, "utf8");
    } catch {
      return [];
    }
    const entries = text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => {
        try {
          return JSON.parse(line) as AuditEntry;
        } catch {
          return undefined;
        }
      })
      .filter((entry): entry is AuditEntry => entry !== undefined);
    return entries.slice(-limit);
  }
}
