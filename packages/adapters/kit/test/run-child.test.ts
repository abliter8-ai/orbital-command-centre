import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { commandForBin, runChild } from "../src/run-child.js";

const echoScript = join(dirname(fileURLToPath(import.meta.url)), "echo-stdin.mjs");

describe("runChild", () => {
  it("routes .mjs bins through node", () => {
    expect(commandForBin("/tmp/fake.mjs", ["--version"])).toEqual({
      command: process.execPath,
      args: ["/tmp/fake.mjs", "--version"],
    });
  });

  it("writes stdin and captures stdout", async () => {
    const result = await runChild({
      bin: echoScript,
      args: [],
      cwd: process.cwd(),
      timeoutMs: 5_000,
      stdin: "hello from stdin",
    });
    expect(result.spawnError).toBeUndefined();
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("hello from stdin");
  });
});
