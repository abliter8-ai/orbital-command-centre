#!/usr/bin/env node

const args = process.argv.slice(2);

if (args.includes("--version")) {
  if (process.env.FAKE_AGY_LOGGED_OUT === "1") {
    process.stderr.write("authentication required\n");
    process.exit(1);
  }
  process.stdout.write("1.1.15-fake\n");
  process.exit(0);
}

if (process.env.FAKE_AGY_FAIL === "1") {
  process.stdout.write(
    `${JSON.stringify({
      conversation_id: "",
      status: "ERROR",
      response: "",
      error: "unknown model",
    })}\n`,
  );
  process.exit(1);
}

const pIdx = args.indexOf("-p");
const brief = pIdx >= 0 ? (args[pIdx + 1] ?? "") : "";

process.stdout.write(
  `${JSON.stringify({
    conversation_id: "agy-sess-1",
    status: "SUCCESS",
    response: brief.includes("PING") ? "PING" : `Agy heard: ${brief}`,
    duration_seconds: 1.2,
    usage: { input_tokens: 20, output_tokens: 4, cache_read_tokens: 0 },
  })}\n`,
);
if (process.env.FAKE_AGY_SOFT_DENY === "1") {
  process.stderr.write("Tool command(npm) would have asked. Allow this tool in settings.\n");
}
process.exit(0);
