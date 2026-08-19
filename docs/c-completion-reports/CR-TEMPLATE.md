---
title: "CR-XXX <Short Name>"
date: YYYY-MM-DD
plan_ref: IP-XXX_<Slug>.md
status: complete | partial | blocked
testing:
  unit: false
  integration: false
  manual: false
deployed:
  production: false
context_updated: false
---

# CR-XXX — <name>

<!-- Frontmatter must be honest — the post-write hook checks that `true` claims are backed
     by evidence in the body. Never mark testing true if it didn't happen. -->

## Summary

One paragraph: the goal, what was achieved, what wasn't.

## Evidence by plan step

Per IP step: what was done, the command(s) run, and the **observed** output — not
assertions. Failed steps reported with their output; skipped steps named as skipped.

## Deviations from plan

What differed from the approved IP and why. Deviations without justification are scope
creep — surface them, don't bury them.

## Known issues & follow-ons

What remains, what broke elsewhere, follow-on IP if indicated. Update KNOWN_ISSUES.md
where the project keeps one.

## David's manual checklist

Anything only he can do (credential rotation, dashboard actions, approvals) — stated
plainly, nothing silently assumed done.

## Rollback

How to restore pre-change state: archive locations, git tags, exact steps.
