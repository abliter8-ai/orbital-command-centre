import type { ReasoningEffort } from "@occ/core";

/**
 * Brief builders for Grok's native tools (X search, web, Imagine). The CLI
 * takes no flags for these — the recipes below are the headless contract from
 * docs/source-refs/grok-p-x-search.md and grok-p-imagine.md (captured live
 * 2026-08-19). The model fills the tool schema from the English brief.
 */

export interface GrokXSearchOptions {
  /** Keyword operators string or a semantic description of what to find. */
  query: string;
  cwd: string;
  /** Latest = recency, Top = engagement. Capitalised: that is what the tool expects. */
  mode?: "Latest" | "Top";
  /** Restrict to one account, without the @ (e.g. "AnthropicAI"). */
  fromUser?: string;
  windowDays?: number;
  /** Max 10 per call — that is the X tool ceiling. */
  limit?: number;
  /** Meaning-based retrieval instead of keyword operators. */
  semantic?: boolean;
  excludeReplies?: boolean;
  model?: string;
  effort?: ReasoningEffort;
  timeoutMs?: number;
}

export interface GrokImagineOptions {
  /** Visual prompt: subject → setting → style → lighting. Prose, not tags. */
  prompt: string;
  cwd: string;
  aspectRatio?: "1:1" | "16:9" | "9:16" | "3:2" | "2:3";
  /** Absolute path (or HTTPS/data URL). Set → image_edit; unset → image_gen. */
  sourceImage?: string;
  /** For edits: what must stay the same (face, composition, …). */
  keepFromSource?: string;
  model?: string;
  effort?: ReasoningEffort;
  timeoutMs?: number;
}

export interface GrokVideoOptions {
  /** Absolute path to frame 1. There is no text-to-video. */
  sourceImage: string;
  cwd: string;
  /** One present-tense moment, one camera move, 1–2 sentences. */
  prompt?: string;
  duration?: 6 | 10;
  resolution?: "480p" | "720p";
  model?: string;
  effort?: ReasoningEffort;
  timeoutMs?: number;
  /** Tool-loop cap; gen/edit/animate chains need several turns. Default 8. */
  maxTurns?: number;
}

export function buildXSearchBrief(opts: GrokXSearchOptions): string {
  const parts: string[] = [];
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 10);
  const window = opts.windowDays ? `last ${opts.windowDays} days` : "last 7 days";

  if (opts.semantic) {
    parts.push(`Semantic search X for ${opts.query}.`);
    if (opts.fromUser) parts.push(`Restrict to username ${opts.fromUser}.`);
  } else {
    let query = opts.query;
    if (opts.fromUser && !/(?:^|\s)from:\S+/.test(query)) {
      query = `from:${opts.fromUser} ${query}`;
    }
    if (opts.excludeReplies && !/-filter:replies/.test(query)) {
      query = `${query} -filter:replies`;
    }
    parts.push(`Search X. Keyword query: ${query}.`);
  }
  parts.push(`Mode: ${opts.mode ?? "Latest"}.`);
  parts.push(`Window: ${window}.`);
  parts.push(`Return the ${limit} most relevant: date, URL, one-line gist.`);
  parts.push("Do not use generic web search.");
  return parts.join(" ");
}

export function buildImagineBrief(opts: GrokImagineOptions): string {
  if (opts.sourceImage) {
    const keep = opts.keepFromSource
      ? ` Keep unchanged: ${opts.keepFromSource}.`
      : " Keep the subject and composition unchanged.";
    return `Use image_edit on ${opts.sourceImage}. ${opts.prompt}.${keep} Print only the saved absolute path.`;
  }
  const aspect = opts.aspectRatio ? `, aspect_ratio ${opts.aspectRatio}` : "";
  return `Use image_gen${aspect}. ${opts.prompt}. Print only the saved absolute path.`;
}

export function buildVideoBrief(opts: GrokVideoOptions): string {
  const duration = opts.duration ?? 6;
  const resolution = opts.resolution ?? "480p";
  const motion = opts.prompt?.trim() || "Subtle natural motion, camera otherwise still.";
  return `Use image_to_video on ${opts.sourceImage}. ${duration} seconds, ${resolution}. ${motion} Print only the saved absolute path.`;
}

/** Absolute media paths the model printed (images/ and videos/ outputs). */
export function extractSavedPaths(text: string): string[] {
  const matches = text.match(/(?:\/[^\s"'`()[\]{}]+)+\.(?:jpe?g|png|webp|gif|mp4|mov|webm)/gi);
  return [...new Set(matches ?? [])];
}
