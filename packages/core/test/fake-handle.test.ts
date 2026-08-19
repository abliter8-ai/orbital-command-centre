import { describe, expect, it } from "vitest";
import { FakeAgentHandle } from "../src/fake-handle.js";

describe("FakeAgentHandle", () => {
  it("records prompts and returns the canned result", async () => {
    const handle = new FakeAgentHandle({ summary: "canned" });
    const session = await handle.startSession({ cwd: "/tmp/work" });
    const result = await handle.prompt(session, { brief: "implement X" });
    expect(handle.prompts).toHaveLength(1);
    expect(handle.prompts[0]?.request.brief).toBe("implement X");
    expect(result.summary).toBe("canned");
    expect(result.cwd).toBe("/tmp/work");
    await handle.cancel("task_1");
    expect(handle.cancelledTaskIds).toEqual(["task_1"]);
  });
});
