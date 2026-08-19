import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CursorAgentHandle } from "../src/cursor-handle.js";

const fakeBin = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-agent.mjs");

describe("CursorAgentHandle", () => {
  const previous = process.env.CURSOR_BIN;

  afterEach(() => {
    if (previous === undefined) delete process.env.CURSOR_BIN;
    else process.env.CURSOR_BIN = previous;
    delete process.env.FAKE_AGENT_FAIL;
    delete process.env.FAKE_AGENT_LOGGED_OUT;
  });

  it("reports availability from the stub", async () => {
    process.env.CURSOR_BIN = fakeBin;
    const handle = new CursorAgentHandle();
    const availability = await handle.isAvailable();
    expect(availability.available).toBe(true);
    expect(availability.authenticated).toBe(true);
    expect(availability.version).toBe("2026.08.11-e8db854-fake");
  });

  it("runs a read-only turn and maps the json result", async () => {
    process.env.CURSOR_BIN = fakeBin;
    const handle = new CursorAgentHandle();
    const session = await handle.startSession({ cwd: process.cwd() });
    const result = await handle.prompt(session, {
      brief: "Reply with the word PING and do not change any files.",
      sandbox: "read-only",
    });
    expect(result.status).toBe("succeeded");
    expect(result.output).toBe("PING");
    expect(result.sessionId).toBe("cursor-sess-1");
    expect(result.agentId).toBe("cursor");
  });

  it("derives file changes from a write-mode stream", async () => {
    process.env.CURSOR_BIN = fakeBin;
    const handle = new CursorAgentHandle();
    const session = await handle.startSession({ cwd: process.cwd() });
    const result = await handle.prompt(session, {
      brief: "edit the docs",
      sandbox: "workspace-write",
    });
    expect(result.status).toBe("succeeded");
    expect(result.filesChanged).toEqual([{ path: "docs/note.md", change: "mod" }]);
    expect(result.sessionId).toBe("cursor-sess-2");
  });

  it("maps stub failure to agent_failed", async () => {
    process.env.CURSOR_BIN = fakeBin;
    process.env.FAKE_AGENT_FAIL = "1";
    const handle = new CursorAgentHandle();
    const session = await handle.startSession({ cwd: process.cwd() });
    const result = await handle.prompt(session, { brief: "explode" });
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("agent_failed");
    expect(result.error?.message).toMatch(/Cannot use this model/);
  });
});
