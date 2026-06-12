# 0001 — Record architecture decisions

**Status:** accepted · 2026-06-12

## Context

This is a greenfield PSA platform with many open design decisions (DB, ORM, auth, capacity model, rate model). Future Claude Code sessions need to know *why* choices were made to avoid relitigating or silently reversing them.

## Decision

Keep ADRs in `docs/decisions/`, one numbered file per decision. The `librarian` subagent records a new ADR whenever a non-obvious architectural or modelling choice is made. The main agent dispatches the librarian after major changes.

## Consequences

- Decisions and their rejected alternatives are preserved, not just the resulting code.
- Adds a small, deliberate doc step to significant changes — owned by the librarian, not the main session, to keep main context lean.
