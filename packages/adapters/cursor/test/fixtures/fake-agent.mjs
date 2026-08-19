#!/usr/bin/env node
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);

if (args.includes("--version") || args[0] === "--version") {
  process.stdout.write("2026.08.11-e8db854-fake\n");
  process.exit(0);
}

if (args.includes("status") || args[0] === "status") {
  if (process.env.FAKE_AGENT_LOGGED_OUT === "1") {
    process.stdout.write("Not signed in.\n");
    process.exit(1);
  }
  process.stdout.write("✓ Logged in as test@example.com\n");
  process.exit(0);
}

const formatIdx = args.indexOf("--output-format");
const format = formatIdx >= 0 ? args[formatIdx + 1] : "text";
const brief = readFileSync(0, "utf8").trim();

if (process.env.FAKE_AGENT_FAIL === "1") {
  process.stderr.write("Cannot use this model: bogus.\n");
  process.exit(1);
}

if (format === "json") {
  process.stdout.write(
    `${JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: brief.includes("PING") ? "PING" : `Cursor heard: ${brief}`,
      session_id: "cursor-sess-1",
    })}\n`,
  );
  process.exit(0);
}

const events = [
  { type: "system", subtype: "init", session_id: "cursor-sess-2" },
  {
    type: "tool_call",
    subtype: "completed",
    tool_call: { writeToolCall: { args: { path: "docs/note.md" } } },
  },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Updated docs/note.md",
    session_id: "cursor-sess-2",
  },
];
for (const event of events) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
process.exit(0);
