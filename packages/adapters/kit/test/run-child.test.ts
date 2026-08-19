import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildSpawnOptions, commandForBin, runChild } from "../src/run-child.js";

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

  it("detaches on POSIX so the child leads a process group", () => {
    const opts = buildSpawnOptions({ bin: "x", args: [], cwd: "/tmp", timeoutMs: 1000 });
    expect(opts.detached).toBe(process.platform !== "win32");
    expect(opts.stdio).toEqual(["ignore", "pipe", "pipe"]);
    const withStdin = buildSpawnOptions({
      bin: "x",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdin: "hi",
    });
    expect(withStdin.stdio).toEqual(["pipe", "pipe", "pipe"]);
  });

  it.runIf(process.platform !== "win32")(
    "kills the whole process group on timeout, including grandchildren",
    async () => {
      const marker = join(tmpdir(), `occ-kill-tree-${process.pid}-${Date.now()}`);
      await rm(marker, { force: true });
      const result = await runChild({
        bin: "sh",
        // Grandchild writes the marker after 1s — only if it survives the timeout.
        args: ["-c", `(sleep 1; touch "${marker}") & exec sleep 30`],
        cwd: process.cwd(),
        timeoutMs: 300,
        killGraceMs: 500,
      });
      expect(result.timedOut).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect(existsSync(marker)).toBe(false);
      await rm(marker, { force: true });
    },
    10_000,
  );
});
