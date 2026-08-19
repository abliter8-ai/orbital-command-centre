import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CodexAgentHandle } from "../src/codex-handle.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fakeBin = join(fixtures, "fake-codex.mjs");

describe("CodexAgentHandle", () => {
  const previousBin = process.env.CODEX_BIN;

  afterEach(() => {
    if (previousBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = previousBin;
    delete process.env.FAKE_CODEX_FAIL;
    delete process.env.FAKE_CODEX_LOGIN;
    delete process.env.FAKE_CODEX_FIXTURE;
  });

  it("runs a successful fake exec and maps JSONL", async () => {
    process.env.CODEX_BIN = fakeBin;
    const handle = new CodexAgentHandle();
    const availability = await handle.isAvailable();
    expect(availability.available).toBe(true);
    expect(availability.version).toBe("0.148.0-fake");

    const session = await handle.startSession({ cwd: process.cwd() });
    const result = await handle.prompt(session, {
      brief: "update the docs",
      sandbox: "read-only",
    });
    expect(result.status).toBe("succeeded");
    expect(result.output).toBe("Updated the docs and added examples.");
    expect(result.sessionId).toBe("0199a213-81c0-7800-8aa1-bbab2a035a53");
    expect(result.filesChanged).toEqual([
      { path: "docs/exec.md", change: "mod" },
      { path: "README.md", change: "add" },
    ]);
    expect(result.error).toBeUndefined();
  });

  it("maps a failed fake exec to agent_failed", async () => {
    process.env.CODEX_BIN = fakeBin;
    process.env.FAKE_CODEX_FAIL = "1";
    process.env.FAKE_CODEX_FIXTURE = join(fixtures, "exec-failed.jsonl");
    const handle = new CodexAgentHandle();
    const session = await handle.startSession({ cwd: process.cwd() });
    const result = await handle.prompt(session, { brief: "explode" });
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("agent_failed");
    expect(result.error?.message).toMatch(/stream ended unexpectedly/);
  });

  it("rejects a missing cwd", async () => {
    process.env.CODEX_BIN = fakeBin;
    const handle = new CodexAgentHandle();
    const session = await handle.startSession({
      cwd: "/tmp/occ-does-not-exist-xyz",
    });
    const result = await handle.prompt(session, { brief: "nope" });
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("invalid_cwd");
  });
});
