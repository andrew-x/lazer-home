---
description: Audit code craft — consistency, DRY, organization, extensibility, and staff-level quality across the codebase. Read-only; reports findings and proposed fixes.
agent: plan
---

Invoke the **`audit-quality`** skill and follow it exactly.

Scope for this run: **$ARGUMENTS** (if empty, audit the whole codebase).

<!--
  Thin on purpose — the procedure lives once, in .agents/skills/audit-quality/SKILL.md,
  which opencode discovers natively. `agent: plan` enforces the read-only contract.
-->
