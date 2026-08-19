---
title: "HANDOFF-YYYYMMDD-<slug>"
date: YYYY-MM-DD
author: <agent/session>
status: running | checkpointed | blocked | consumed
objective: <one line — what "done" looks like>
---

# Handoff — <slug>

## Objective & success criteria

What is being produced, and how the resuming agent verifies it is done.

## Current state

What is complete so far, and how each completed item was verified (commands + observed
output, not assertions).

## Running / pending processes

| What | Command (exact, absolute paths) | Log path | Expected output | Checkpoint file |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## Resume instructions

Numbered, exact steps an agent with zero context can execute — including how to detect
whether the process survived (log tail patterns, checkpoint mtime, output file presence)
and what to do in each case (still running / finished / died).

## Recovery

How to restart safely if the process died mid-way: idempotency notes, what NOT to re-run,
where partial output lives.

## Risks / gotchas

Anything that will bite the resuming agent: rate limits, cold-start delays, host-specific
paths, credentials expected in env.
