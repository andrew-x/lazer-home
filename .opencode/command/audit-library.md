---
description: Audit /docs against the code — verify every doc is accurate and current, flag significant code↔doc discrepancies for you to adjudicate. Read-only; never edits.
agent: plan
---

Invoke the **`audit-library`** skill and follow it exactly.

Scope for this run: **$ARGUMENTS** (if empty, audit every doc).

<!--
  Thin on purpose — the procedure lives once, in .agents/skills/audit-library/SKILL.md,
  which opencode discovers natively. `agent: plan` enforces the read-only contract.
-->
