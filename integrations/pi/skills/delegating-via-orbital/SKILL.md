---
name: delegating-via-orbital
description: Escalate to a stronger or specialized coding agent via the local orbital daemon's A2A HTTP endpoints. Use when stuck, when the task needs a bigger cloud model, live X/web search, image or video generation, a clean-context second opinion, or parallel implementation help. Works with plain curl — no MCP required.
---

# Delegating via orbital (A2A over HTTP)

The orbital daemon on this machine hosts five coding agents — **codex, cursor, grok, antigravity, claude** — behind one loopback port. You delegate by POSTing JSON-RPC with `curl`; no MCP client needed.

## When to use

- You are stuck: the same approach has failed twice, or the error is outside your model's knowledge.
- The task needs live intel: Grok has native X search and current-information tools.
- The task needs media: Grok can generate/edit images and short video.
- You want a second opinion from a clean context (claude is good at this), or a parallel worker on an isolated subtask.
- The user explicitly asks to "tag-team", "escalate", or "phone a friend".

## 0. Check the daemon

```bash
curl -s --max-time 3 http://127.0.0.1:7100/v1/registry
```

If that fails, the daemon is not running. Tell the user to start it (`orbital up`, or `node packages/control-plane/dist/cli.js up` from the orbital-command-centre repo) — do not try to install or start it silently.

The registry lists each agent's availability and live model catalog. Per-agent cards (capabilities, skills) are at `http://127.0.0.1:7100/agents/<id>/.well-known/agent-card.json`.

## 1. Delegate (blocking)

```bash
curl -s -X POST http://127.0.0.1:7100/agents/grok/ \
  -H 'content-type: application/json' \
  -d '{
    "jsonrpc": "2.0", "id": 1, "method": "SendMessage",
    "params": {
      "message": {
        "messageId": "msg-1", "role": "user",
        "parts": [{"kind": "text", "text": "Search X for current reports of <thing>. Return 5 findings with links."}],
        "metadata": {"cwd": "/path/to/project", "sandbox": "workspace-write"}
      }
    }
  }' --max-time 600
```

The response is `result.task`: `status.state` (`TASK_STATE_COMPLETED` / `FAILED` / `CANCELED`) plus `artifacts[0].parts[0].text` with the agent's result.

Message metadata (all optional):

| key | values | default |
|-----|--------|---------|
| `cwd` | absolute path the agent works in | daemon's cwd |
| `sandbox` | `read-only` · `workspace-write` · `danger-full-access` | `workspace-write` (policy may cap) |
| `model` | a model id from the registry | agent default |
| `effort` | `low` · `medium` · `high` · `xhigh` · `max` | agent default |

## 2. Long tasks: stream, and survive disconnects

For anything that may run minutes, use `SendStreamingMessage` (same body, method name swapped). The response is SSE (`data: <json>` per line pair); the **first frame contains the full task object — record `task.id` immediately**.

If your curl dies mid-run, the task keeps going server-side and is crash-proof (persisted under `~/.occ/a2a-tasks/`). Recover it:

```bash
# find it (sorted by recency)
curl -s -X POST http://127.0.0.1:7100/agents/grok/ -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"ListTasks","params":{"includeArtifacts":true}}'
# then fetch the result
curl -s -X POST http://127.0.0.1:7100/agents/grok/ -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"GetTask","params":{"id":"<taskId>"}}'
```

Cancel a runaway task with `CancelTask` and `{"id": "<taskId>"}`.

## 3. Who to call

- **grok** — live X search, current events, image gen/edit, short video. Say *in the brief* that you want its native search/media tools used.
- **antigravity** — deep web research with sources.
- **claude** — strong reasoning tier; clean-context second opinion (`sandbox: "read-only"` for review-only).
- **codex** — disciplined implementation, diffs, tests; `codex review`-style critique.
- **cursor** — fast iterations; also surfaces Grok models.

## Rules

- Briefs are self-contained: the delegate has none of your conversation context. Include file paths, error text, and what you already tried.
- Delegates run with their own tools in `cwd`; `read-only` sandboxes cannot modify files — use it for research/review.
- Results come back as text artifacts; files a delegate changed are listed in artifact metadata (`filesChanged`).
