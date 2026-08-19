// Moved to @occ/core (shared by the MCP façade, A2A cards, and the control
// plane). This re-export keeps existing imports working.
export {
  nativeCapabilities,
  type AgentNativeProfile,
  type NativeCapability,
} from "@occ/core";
