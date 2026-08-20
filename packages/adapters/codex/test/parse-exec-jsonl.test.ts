import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseExecJsonl, streamEventFromExecLine } from "../src/parse-exec-jsonl.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("parseExecJsonl", () => {
  it("parses a successful turn, maps file changes, and ignores reconnect errors", () => {
    const text = readFileSync(join(fixtures, "exec-success.jsonl"), "utf8");
    const parsed = parseExecJsonl(text);
    expect(parsed.threadId).toBe("0199a213-81c0-7800-8aa1-bbab2a035a53");
    expect(parsed.output).toBe("Updated the docs and added examples.");
    expect(parsed.filesChanged).toEqual([
      { path: "docs/exec.md", change: "mod" },
      { path: "README.md", change: "add" },
    ]);
    expect(parsed.usage).toEqual({
      inputTokens: 100,
      cachedInputTokens: 80,
      outputTokens: 20,
    });
    expect(parsed.fatalError).toBeUndefined();
    expect(parsed.turnFailed).toBeUndefined();
  });

  it("captures turn.failed", () => {
    const text = readFileSync(join(fixtures, "exec-failed.jsonl"), "utf8");
    const parsed = parseExecJsonl(text);
    expect(parsed.threadId).toBe("thread-fail-1");
    expect(parsed.turnFailed).toBe("model response stream ended unexpectedly");
  });

  it("treats non-reconnect type=error as fatal", () => {
    const parsed = parseExecJsonl(
      '{"type":"error","message":"stream error: broken pipe"}\n',
    );
    expect(parsed.fatalError).toBe("stream error: broken pipe");
  });
});

describe("streamEventFromExecLine", () => {
  it("maps agent_message completion to a text event", () => {
    expect(
      streamEventFromExecLine(
        '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"PONG"}}',
      ),
    ).toEqual({ kind: "text", text: "PONG" });
  });

  it("maps tool items to start/end events", () => {
    expect(
      streamEventFromExecLine('{"type":"item.started","item":{"id":"i0","type":"command_execution"}}'),
    ).toEqual({ kind: "tool_start", text: "command_execution" });
    expect(
      streamEventFromExecLine('{"type":"item.completed","item":{"id":"i0","type":"file_change","changes":[]}}'),
    ).toEqual({ kind: "tool_end", text: "file_change" });
  });

  it("returns null for bookkeeping, errors, and junk", () => {
    expect(streamEventFromExecLine('{"type":"thread.started","thread_id":"t"}')).toBeNull();
    expect(streamEventFromExecLine('{"type":"turn.completed","usage":{}}')).toBeNull();
    expect(
      streamEventFromExecLine('{"type":"item.completed","item":{"type":"error","message":"x"}}'),
    ).toBeNull();
    expect(streamEventFromExecLine("not json")).toBeNull();
  });
});
