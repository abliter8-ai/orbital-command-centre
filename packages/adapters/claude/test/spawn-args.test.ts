import { describe, expect, it } from "vitest";
import {
  CLAUDE_PERMISSION_MODE,
  EMPTY_MCP_CONFIG,
  buildClaudeHeadlessArgs,
} from "../src/spawn-args.js";

describe("buildClaudeHeadlessArgs", () => {
  it("maps sandboxes to permission modes", () => {
    expect(CLAUDE_PERMISSION_MODE["read-only"]).toBe("plan");
    expect(CLAUDE_PERMISSION_MODE["workspace-write"]).toBe("acceptEdits");
    expect(CLAUDE_PERMISSION_MODE["danger-full-access"]).toBe("bypassPermissions");
  });

  it("always streams, runs clean of user MCP servers, and carries the model", () => {
    const args = buildClaudeHeadlessArgs({ sandbox: "read-only", model: "sonnet" });
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args).toContain("--verbose");
    expect(args).toContain("--permission-mode");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("plan");
    expect(args).toContain("--strict-mcp-config");
    expect(args[args.indexOf("--mcp-config") + 1]).toBe(EMPTY_MCP_CONFIG);
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
  });

  it("resumes real session ids and ignores pending ones", () => {
    const resumed = buildClaudeHeadlessArgs({
      sandbox: "workspace-write",
      resumeSessionId: "c36e8912-d548-428b-abf8-7425f5932238",
    });
    expect(resumed[resumed.indexOf("--resume") + 1]).toBe(
      "c36e8912-d548-428b-abf8-7425f5932238",
    );

    const fresh = buildClaudeHeadlessArgs({
      sandbox: "workspace-write",
      resumeSessionId: "pending_abc",
    });
    expect(fresh).not.toContain("--resume");
  });

  it("omits --model when unset", () => {
    expect(buildClaudeHeadlessArgs({ sandbox: "workspace-write" })).not.toContain("--model");
  });
});
