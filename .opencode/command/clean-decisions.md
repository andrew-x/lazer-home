---
description: Consolidate the ADRs in docs/decisions — merge duplicates, drop superseded decisions, fix all cross-references
agent: build
---

Invoke the **`clean-decisions`** skill and follow it exactly.

Scope for this run: **$ARGUMENTS** (if empty, consider every ADR).

<!--
  Thin on purpose — the procedure lives once, in .agents/skills/clean-decisions/SKILL.md,
  which opencode discovers natively.

  `agent: build` (not `plan`) because, unlike the audit commands, this one is
  deliberately destructive: it rewrites and deletes ADRs, so it needs edit access.
-->
