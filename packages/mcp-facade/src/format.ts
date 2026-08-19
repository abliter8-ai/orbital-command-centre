import type { DelegationResult } from "@occ/core";

export function formatDelegationMarkdown(result: DelegationResult): string {
  const files =
    result.filesChanged.length === 0
      ? "_none_"
      : result.filesChanged.map((file) => `- ${file.change} \`${file.path}\``).join("\n");

  const error = result.error
    ? [
        "",
        "### Error",
        `- **code:** ${result.error.code}`,
        `- **message:** ${result.error.message}`,
        result.error.hint ? `- **hint:** ${result.error.hint}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return [
    `## Codex delegation`,
    `- **status:** ${result.status}`,
    `- **sessionId:** ${result.sessionId}`,
    `- **taskId:** ${result.taskId}`,
    `- **cwd:** ${result.cwd}`,
    `- **durationMs:** ${result.durationMs}`,
    "",
    "### Summary",
    result.summary || "_empty_",
    "",
    "### Files changed",
    files,
    result.diffStat ? `\n### Diff stat\n\`\`\`\n${result.diffStat}\n\`\`\`` : "",
    "",
    "### Output",
    result.output || "_empty_",
    error,
  ]
    .filter((line) => line !== "")
    .join("\n");
}
