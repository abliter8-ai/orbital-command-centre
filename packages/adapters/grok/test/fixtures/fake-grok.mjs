#!/usr/bin/env node

const args = process.argv.slice(2);

if (args.includes("--version")) {
  if (process.env.FAKE_GROK_LOGGED_OUT === "1") {
    process.stdout.write("grok 1.0.5-fake (deadbeef) [stable]\nYou are not logged in. Run `grok login`.\n");
    process.exit(0);
  }
  process.stdout.write("grok 1.0.5-fake (deadbeef) [stable]\n");
  process.exit(0);
}

if (args.includes("models")) {
  if (process.env.FAKE_GROK_LOGGED_OUT === "1") {
    process.stdout.write("You are not logged in. Run `grok login`.\n");
    process.exit(1);
  }
  process.stdout.write(
    [
      "You are logged in with grok.com.",
      "",
      "Default model: grok-4.6",
      "",
      "Available models:",
      "  * grok-4.6 (default)",
      "  - grok-4.5",
      "  - dsv4-think",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

if (process.env.FAKE_GROK_FAIL === "1") {
  process.stderr.write("Cannot use this model: bogus.\n");
  process.stdout.write(
    `${JSON.stringify({
      text: "Cannot use this model: bogus.",
      sessionId: "grok-sess-fail",
      stopReason: "error",
    })}\n`,
  );
  process.exit(1);
}

const pIdx = args.indexOf("-p");
const brief = pIdx >= 0 ? (args[pIdx + 1] ?? "") : "";

process.stdout.write(
  `${JSON.stringify({
    text: brief.includes("PING") ? "PING" : `Grok heard: ${brief}`,
    sessionId: "grok-sess-1",
    stopReason: "end_turn",
    usage: {
      input_tokens: 10,
      output_tokens: 4,
      cache_read_input_tokens: 0,
    },
  })}\n`,
);
process.exit(0);
