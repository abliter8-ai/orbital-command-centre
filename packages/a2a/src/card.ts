import type { AgentCard, AgentSkill } from "@a2a-js/sdk";
import { nativeCapabilities, type AgentId } from "@occ/core";

const DISPLAY_NAMES: Record<AgentId, string> = {
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok",
  antigravity: "Antigravity",
};

function skillId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/**
 * Build the A2A AgentCard for one OCC agent. Skills come from the curated
 * native-capability profile (docs/source-refs, reviewed 2026-08-19) — the same
 * map `occ_capabilities` serves over MCP.
 */
export function buildAgentCard(agentId: AgentId, url: string): AgentCard {
  const profile = nativeCapabilities()[agentId];
  const skills: AgentSkill[] = [
    {
      id: "delegate",
      name: "Delegate a task",
      description: `Run a self-contained brief on ${DISPLAY_NAMES[agentId]} and return the result. Message metadata: cwd, sandbox (read-only|workspace-write|danger-full-access), model, effort.`,
      tags: ["code", "delegation"],
      examples: ["Add a unit test for parseExecJsonl and run it"],
      inputModes: [],
      outputModes: [],
      securityRequirements: [],
    },
    ...profile.nativeTools.map(
      (tool): AgentSkill => ({
        id: skillId(tool.name),
        name: tool.name,
        description: `${tool.summary} Reach via: ${tool.invoke}.${tool.notes ? ` ${tool.notes}` : ""}`,
        tags: [tool.kind],
        examples: [],
        inputModes: [],
        outputModes: [],
        securityRequirements: [],
      }),
    ),
  ];

  return {
    name: `OCC ${DISPLAY_NAMES[agentId]}`,
    description: profile.differentiator,
    supportedInterfaces: [{ url, protocolBinding: "JSONRPC", protocolVersion: "1.0", tenant: "" }],
    provider: { organization: "Orbital Command Centre", url: "" },
    version: "0.1.0",
    capabilities: { streaming: false, pushNotifications: false, extensions: [] },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills,
    signatures: [],
  };
}
