export const DEFAULT_TIMEOUT_MS = 600_000;
export const MAX_TIMEOUT_MS = 1_800_000;

export function clampTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(timeoutMs, 1_000), MAX_TIMEOUT_MS);
}

export function summariseOutput(output: string, maxChars = 1500): string {
  if (output.length <= maxChars) return output;
  return `${output.slice(0, maxChars).trimEnd()}…`;
}
