---
title: "IP-XXX <Short Name>"
date: YYYY-MM-DD
status: draft
slug: <kebab-case-matching-CR>
idea_ref: IDEA-XXX-<file>.md
---

# IP-XXX — <name>

<!-- Naming: IP-XXX_<Slug>.md → CR-XXX_<Slug>.md, matching number and slug.
     David approves before any implementation. status: draft → approved (date, decisions). -->

## Problem Statement

One paragraph: what is broken/missing and the cost of leaving it.

## Scope

**In:** …
**Out (explicitly):** … <!-- silent scope creep is a workflow violation -->

## Approach & architecture decisions

The chosen route and the rationale — grounded in current repo state (inspected, not
assumed) and live-verified external facts. Distinguish: current state / recommended
change / speculative idea.

## Implementation steps

Numbered, concrete: exact files, exact edits or commands, in execution order. An agent
should be able to execute this end-to-end without re-deriving intent.

## Risks & edge cases

| Risk | Mitigation |
| --- | --- |
|  |  |

## Verification & rollback

Commands to run, expected outputs / success criteria, rollback steps. Anything displaced
goes to `_archive/`, never deleted.

## Decisions needed from David

Numbered. Recommendation first, marked. On approval, note which decisions were taken
with which options.
