import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { AntigravityAgentHandle } from "../src/antigravity-handle.js";

const fakeBin = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-agy.mjs");

describe("AntigravityAgentHandle", () => {
  const previous = process.env.AGY_BIN;

  afterEach(() => {
    if (previous === undefined) delete process.env.AGY_BIN;
    else process.env.AGY_BIN = previous;
    delete process.env.FAKE_AGY_FAIL;
    delete process.env.FAKE_AGY_LOGGED_OUT;
    delete process.env.FAKE_AGY_SOFT_DENY;
  });

  it("reports availability from the stub", async () => {
    process.env.AGY_BIN = fakeBin;
    const handle = new AntigravityAgentHandle();
    const availability = await handle.isAvailable();
    expect(availability.available).toBe(true);
    expect(availability.authenticated).toBe(true);
    expect(availability.version).toBe("1.1.15-fake");
  });

  it("treats authentication required as unauthenticated", async () => {
    process.env.AGY_BIN = fakeBin;
    process.env.FAKE_AGY_LOGGED_OUT = "1";
    const handle = new AntigravityAgentHandle();
    const availability = await handle.isAvailable();
    expect(availability.available).toBe(false);
    expect(availability.authenticated).toBe(false);
  });

  it("runs a turn and maps the json result", async () => {
    process.env.AGY_BIN = fakeBin;
    const handle = new AntigravityAgentHandle();
    const session = await handle.startSession({ cwd: process.cwd() });
    const result = await handle.prompt(session, {
      brief: "Reply with the word PING and do not change any files.",
      sandbox: "read-only",
    });
    expect(result.status).toBe("succeeded");
    expect(result.output).toBe("PING");
    expect(result.sessionId).toBe("agy-sess-1");
    expect(result.agentId).toBe("antigravity");
  });

  it("maps stub failure to agent_failed", async () => {
    process.env.AGY_BIN = fakeBin;
    process.env.FAKE_AGY_FAIL = "1";
    const handle = new AntigravityAgentHandle();
    const session = await handle.startSession({ cwd: process.cwd() });
    const result = await handle.prompt(session, { brief: "explode" });
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("agent_failed");
    expect(result.error?.message).toMatch(/unknown model/);
  });
});
