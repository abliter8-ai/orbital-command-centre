#!/usr/bin/env node
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("2.1.235-fake (Claude Code)\n");
  process.exit(0);
}

if (args[0] === "auth" && args[1] === "status") {
  if (process.env.FAKE_CLAUDE_LOGGED_OUT === "1") {
    process.stdout.write(`${JSON.stringify({ loggedIn: false })}\n`);
    process.exit(0);
  }
  process.stdout.write(
    `${JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "test@example.com" })}\n`,
  );
  process.exit(0);
}

const brief = readFileSync(0, "utf8").trim();

if (process.env.FAKE_CLAUDE_FAIL === "1") {
  process.stdout.write(
    `${JSON.stringify({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: "Credit balance too low",
      session_id: "claude-sess-fail",
    })}\n`,
  );
  process.exit(1);
}

const sessionId = process.env.FAKE_CLAUDE_SESSION ?? "claude-sess-1";
const events = [
  { type: "system", subtype: "init", session_id: sessionId, cwd: process.cwd() },
  {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          name: "Write",
          input: { file_path: "docs/note.md", content: "x" },
        },
      ],
    },
  },
  {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", content: "File created successfully" }],
    },
  },
  {
    type: "assistant",
    message: {
      role: "assistant",
      model: "claude-sonnet-5",
      content: [{ type: "text", text: brief.includes("PING") ? "PING" : "Wrote docs/note.md" }],
    },
  },
  { type: "rate_limit_event", rate_limit_info: { status: "allowed" } },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    result: brief.includes("PING") ? "PING" : "Wrote docs/note.md",
    session_id: sessionId,
    total_cost_usd: 0.0123,
    usage: { input_tokens: 3, cache_read_input_tokens: 19000, output_tokens: 7 },
  },
];
for (const event of events) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
process.exit(0);
