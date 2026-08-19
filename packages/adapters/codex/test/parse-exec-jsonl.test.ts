import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseExecJsonl } from "../src/parse-exec-jsonl.js";

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
