import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { GrokAgentHandle } from "../src/grok-handle.js";

const fakeBin = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-grok.mjs");

describe("GrokAgentHandle", () => {
  const previous = process.env.GROK_BIN;

  afterEach(() => {
    if (previous === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = previous;
    delete process.env.FAKE_GROK_FAIL;
    delete process.env.FAKE_GROK_LOGGED_OUT;
  });

  it("reports availability from the stub", async () => {
    process.env.GROK_BIN = fakeBin;
    const handle = new GrokAgentHandle();
    const availability = await handle.isAvailable();
    expect(availability.available).toBe(true);
    expect(availability.authenticated).toBe(true);
    expect(availability.version).toBe("1.0.5-fake");
    expect(availability.detail).toMatch(/grok-4\.6/);
  });

  it("treats a logged-out version probe as unauthenticated", async () => {
    process.env.GROK_BIN = fakeBin;
    process.env.FAKE_GROK_LOGGED_OUT = "1";
    const handle = new GrokAgentHandle();
    const availability = await handle.isAvailable();
    expect(availability.available).toBe(true);
    expect(availability.authenticated).toBe(false);
  });

  it("runs a turn and maps the json result", async () => {
    process.env.GROK_BIN = fakeBin;
    const handle = new GrokAgentHandle();
    const session = await handle.startSession({ cwd: process.cwd(), model: "grok-4.6" });
    const result = await handle.prompt(session, {
      brief: "Reply with the word PING and do not change any files.",
      sandbox: "read-only",
      effort: "low",
    });
    expect(result.status).toBe("succeeded");
    expect(result.output).toBe("PING");
    expect(result.sessionId).toBe("grok-sess-1");
    expect(result.agentId).toBe("grok");
    expect(result.usage?.inputTokens).toBe(10);
  });

  it("maps stub failure to agent_failed", async () => {
    process.env.GROK_BIN = fakeBin;
    process.env.FAKE_GROK_FAIL = "1";
    const handle = new GrokAgentHandle();
    const session = await handle.startSession({ cwd: process.cwd() });
    const result = await handle.prompt(session, { brief: "explode" });
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("agent_failed");
    expect(result.error?.message).toMatch(/Cannot use this model/);
  });

  it("rejects a missing cwd", async () => {
    process.env.GROK_BIN = fakeBin;
    const handle = new GrokAgentHandle();
    const session = await handle.startSession({
      cwd: "/tmp/occ-does-not-exist-xyz",
    });
    const result = await handle.prompt(session, { brief: "nope" });
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("invalid_cwd");
  });
});
