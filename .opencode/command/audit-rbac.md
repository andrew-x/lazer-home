---
description: Audit RBAC/permissions end-to-end — verify the role matrix, every action's gate, and that nothing bypasses access control. Read-only; flags vulnerabilities.
agent: plan
---

Invoke the **`audit-rbac`** skill and follow it exactly.

Scope for this run: **$ARGUMENTS** (if empty, audit the whole codebase).

<!--
  Thin on purpose — the procedure lives once, in .agents/skills/audit-rbac/SKILL.md,
  which opencode discovers natively. `agent: plan` enforces the read-only contract.
-->
