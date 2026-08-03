---
description: Audit the Claude Code, Codex and opencode agent setups — inventory all three, verify they're in sync (the setup is deliberately duplicated), check against the latest vendor docs, and report drift + improvement recommendations. Read-only.
agent: plan
---

Invoke the **`audit-agents`** skill and follow it exactly.

Scope for this run: **$ARGUMENTS** (if empty, audit everything).

<!--
  Thin on purpose. The procedure lives once, in .agents/skills/audit-agents/SKILL.md,
  which opencode discovers natively (it scans .agents/skills/ alongside .opencode/skill/).
  So opencode shares the skill body with Codex instead of duplicating it — only this
  slash-command entry point is per-runtime. Keeping it a one-line delegation means
  there is no procedure text here that can drift.

  `agent: plan` pins the run to opencode's edit-denied plan agent, so this read-only
  audit is enforced at the tool layer rather than by instruction alone.
-->
