import { AgentRegistry, FakeAgentHandle, InMemoryTaskStore } from "@occ/core";
import { Client } from "@prefecthq/fastmcp-ts/client";
import { describe, expect, it } from "vitest";
import { createOccServer } from "../src/server.js";

describe("createOccServer in-process", () => {
  it("exposes occ_health and delegate_to_codex against a fake handle", async () => {
    const handle = new FakeAgentHandle({
      summary: "in-process canned",
      output: "in-process canned",
    });
    const registry = new AgentRegistry();
    registry.register(handle);
    const server = createOccServer({
      registry,
      store: new InMemoryTaskStore(),
    });

    const client = await Client.connect(server);
    const health = await client.callTool("occ_health", {});
    expect(JSON.stringify(health)).toMatch(/codex/);

    const delegated = await client.callTool("delegate_to_codex", {
      brief: "Reply with PING. Change no files.",
      sandbox: "read-only",
    });
    expect(JSON.stringify(delegated)).toMatch(/in-process canned/);
    expect(handle.prompts).toHaveLength(1);
  });
});
