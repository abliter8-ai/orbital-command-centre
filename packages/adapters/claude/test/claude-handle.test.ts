import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { StreamEvent } from "@occ/core";
import { ClaudeAgentHandle } from "../src/claude-handle.js";

const fakeBin = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-claude.mjs");

describe("ClaudeAgentHandle", () => {
  const previous = process.env.CLAUDE_BIN;

  afterEach(() => {
    if (previous === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = previous;
    delete process.env.FAKE_CLAUDE_FAIL;
    delete process.env.FAKE_CLAUDE_LOGGED_OUT;
  });

  it("reports availability from the stub", async () => {
    process.env.CLAUDE_BIN = fakeBin;
    const handle = new ClaudeAgentHandle();
    const availability = await handle.isAvailable();
    expect(availability.available).toBe(true);
    expect(availability.authenticated).toBe(true);
    expect(availability.version).toBe("2.1.235-fake");
  });

  it("reports logged-out auth status", async () => {
    process.env.CLAUDE_BIN = fakeBin;
    process.env.FAKE_CLAUDE_LOGGED_OUT = "1";
    const handle = new ClaudeAgentHandle();
    const availability = await handle.isAvailable();
    expect(availability.available).toBe(true);
    expect(availability.authenticated).toBe(false);
    expect(availability.detail).toMatch(/auth login/);
  });

  it("runs a turn and maps session, output, usage, and files", async () => {
    process.env.CLAUDE_BIN = fakeBin;
    const handle = new ClaudeAgentHandle();
    const session = await handle.startSession({ cwd: process.cwd() });
    const result = await handle.prompt(session, {
      brief: "Reply with the word PING and do not change any files.",
      sandbox: "read-only",
    });
    expect(result.status).toBe("succeeded");
    expect(result.output).toBe("PING");
    expect(result.sessionId).toBe("claude-sess-1");
    expect(result.agentId).toBe("claude");
    expect(result.usage?.outputTokens).toBe(7);
    expect(result.summary).toContain("$0.0123");
    // The fixture's Write tool_use shows up in the file trail.
    expect(result.filesChanged).toEqual([{ path: "docs/note.md", change: "add" }]);
  });

  it("emits stream events for tool_use, tool_result, and text", async () => {
    process.env.CLAUDE_BIN = fakeBin;
    const handle = new ClaudeAgentHandle();
    const events: StreamEvent[] = [];
    const session = await handle.startSession({ cwd: process.cwd() });
    await handle.prompt(session, {
      brief: "do work",
      sandbox: "workspace-write",
      onEvent: (event) => events.push(event),
    });
    expect(events).toContainEqual({ kind: "tool_start", text: "Write" });
    expect(events).toContainEqual({ kind: "tool_end", text: "tool_result" });
    expect(events).toContainEqual({ kind: "text", text: "Wrote docs/note.md" });
  });

  it("maps an is_error result to a failed delegation", async () => {
    process.env.CLAUDE_BIN = fakeBin;
    process.env.FAKE_CLAUDE_FAIL = "1";
    const handle = new ClaudeAgentHandle();
    const session = await handle.startSession({ cwd: process.cwd() });
    const result = await handle.prompt(session, { brief: "hi" });
    expect(result.status).toBe("failed");
    expect(result.error?.message).toMatch(/Credit balance too low/);
  });

  it("resumes a prior session via --resume", async () => {
    process.env.CLAUDE_BIN = fakeBin;
    process.env.FAKE_CLAUDE_SESSION = "claude-sess-2";
    const handle = new ClaudeAgentHandle();
    const first = await handle.startSession({ cwd: process.cwd() });
    const r1 = await handle.prompt(first, { brief: "PING" });
    const resumed = await handle.startSession({
      cwd: process.cwd(),
      resumeSessionId: r1.sessionId,
    });
    const r2 = await handle.prompt(resumed, { brief: "PING again" });
    expect(r2.sessionId).toBe("claude-sess-2");
    delete process.env.FAKE_CLAUDE_SESSION;
  });
});
