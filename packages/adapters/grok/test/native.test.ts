import { describe, expect, it } from "vitest";
import {
  buildImagineBrief,
  buildVideoBrief,
  buildXSearchBrief,
  extractSavedPaths,
} from "../src/native.js";

describe("buildXSearchBrief", () => {
  it("builds the canonical keyword recipe", () => {
    const brief = buildXSearchBrief({
      query: "Claude OR \"Claude Code\"",
      cwd: "/tmp",
      fromUser: "AnthropicAI",
      mode: "Latest",
      windowDays: 7,
      limit: 10,
      excludeReplies: true,
    });
    expect(brief).toContain("Search X");
    expect(brief).toContain("from:AnthropicAI");
    expect(brief).toContain("-filter:replies");
    expect(brief).toContain("Mode: Latest");
    expect(brief).toContain("last 7 days");
    expect(brief).toContain("10 most relevant");
    expect(brief).toContain("Do not use generic web search");
  });

  it("does not double-apply operators the caller already wrote", () => {
    const brief = buildXSearchBrief({
      query: "from:AnthropicAI -filter:replies Claude",
      cwd: "/tmp",
      fromUser: "AnthropicAI",
      excludeReplies: true,
    });
    expect(brief.match(/from:AnthropicAI/g)).toHaveLength(1);
    expect(brief.match(/-filter:replies/g)).toHaveLength(1);
  });

  it("clamps the limit to the X tool ceiling of 10", () => {
    const brief = buildXSearchBrief({ query: "ai", cwd: "/tmp", limit: 50 });
    expect(brief).toContain("10 most relevant");
  });

  it("uses the semantic recipe when asked", () => {
    const brief = buildXSearchBrief({
      query: "Anthropic product announcements",
      cwd: "/tmp",
      semantic: true,
      fromUser: "AnthropicAI",
    });
    expect(brief).toContain("Semantic search X");
    expect(brief).toContain("username AnthropicAI");
    expect(brief).not.toContain("Keyword query");
  });
});

describe("buildImagineBrief", () => {
  it("generates from scratch with an aspect ratio", () => {
    const brief = buildImagineBrief({
      prompt: "A ceramic mug on oak, window light",
      cwd: "/tmp",
      aspectRatio: "1:1",
    });
    expect(brief).toContain("image_gen");
    expect(brief).toContain("aspect_ratio 1:1");
    expect(brief).toContain("Print only the saved absolute path");
  });

  it("switches to image_edit with a source and keep-list", () => {
    const brief = buildImagineBrief({
      prompt: "Switch to overcast daylight",
      cwd: "/tmp",
      sourceImage: "/Users/roo/Pictures/hero.png",
      keepFromSource: "the face and wardrobe",
    });
    expect(brief).toContain("image_edit on /Users/roo/Pictures/hero.png");
    expect(brief).toContain("Keep unchanged: the face and wardrobe");
    expect(brief).not.toContain("image_gen");
  });
});

describe("buildVideoBrief", () => {
  it("defaults to 6s 480p with a motion fallback", () => {
    const brief = buildVideoBrief({ sourceImage: "/tmp/frame.jpg", cwd: "/tmp" });
    expect(brief).toContain("image_to_video on /tmp/frame.jpg");
    expect(brief).toContain("6 seconds, 480p");
    expect(brief).toContain("Subtle natural motion");
  });

  it("honours duration, resolution and a motion brief", () => {
    const brief = buildVideoBrief({
      sourceImage: "/tmp/frame.jpg",
      cwd: "/tmp",
      prompt: "Slow orbit left, coat hem moving in wind.",
      duration: 10,
      resolution: "720p",
    });
    expect(brief).toContain("10 seconds, 720p");
    expect(brief).toContain("Slow orbit left");
  });
});

describe("extractSavedPaths", () => {
  it("pulls deduped absolute media paths from model output", () => {
    const paths = extractSavedPaths(
      'Done. Saved to /Users/roo/work/images/1.jpg and "/Users/roo/work/videos/2.mp4". Again: /Users/roo/work/images/1.jpg',
    );
    expect(paths).toEqual(["/Users/roo/work/images/1.jpg", "/Users/roo/work/videos/2.mp4"]);
  });

  it("returns [] when nothing was saved", () => {
    expect(extractSavedPaths("PING")).toEqual([]);
  });
});
