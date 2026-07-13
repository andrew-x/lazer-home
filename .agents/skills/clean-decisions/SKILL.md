---
name: clean-decisions
description: Use when you want to consolidate the ADRs in docs/decisions — merging duplicates, dropping superseded decisions, and fixing all cross-references.
---

# Clean up architecture decisions

Consolidate the architecture decision records under `docs/decisions/` so the log reflects only what's currently true. Two operations, both judgment-heavy and **destructive** — do the analysis first, confirm the plan, then edit.

If the user named a scope when invoking this skill (a topic or ADR numbers, e.g. "auth" or "0008 0012"), scope the cleanup to that; otherwise consider every ADR.

## The one inviolable rule

**Never change the thesis of the most-current decision.** Consolidation reorganizes and removes *stale* records; it must not soften, reverse, or "improve" the position a surviving decision actually takes. When in doubt about whether an edit changes meaning, leave the surviving ADR's Decision/Consequences wording intact and stop to ask.

## What to consolidate

1. **Same-topic duplicates** — two or more ADRs about the same choice → merge into **one** record. Keep the most current/complete one as the survivor (prefer keeping the lower number to minimize reference churn), fold in any non-redundant context from the others, then remove the rest.
2. **Superseded decisions ("changed my mind")** — a later ADR overrides an earlier one → **keep the current decision, remove the obsolete one.** Don't leave a superseded stub; the user wants the log to show the current state, not a paper trail.

## Hard constraints

- **Do not renumber surviving ADRs.** Numbers are referenced from code comments, docs prose, and the README log table — renumbering breaks all of them. Removed numbers simply retire; gaps are fine.
- **Never leave a dangling reference.** Every pointer to a removed ADR must be repointed to its survivor (or rewritten if the claim no longer holds). This includes code comments — references appear as `ADR 0007`, `ADR-0006`, `[ADR 0012](...)`, and `decisions/0006` forms across `src/**` and `docs/**`.
- **Leave `docs/decisions/0001-record-architecture-decisions.md` alone** — it's the meta-ADR establishing the practice.

## Procedure

1. **Inventory.** Read every file in `docs/decisions/` (titles, Status, Decision). Build the picture of what each one actually decides.
2. **Map references.** Find every inbound reference so nothing is missed when a number retires:
   ```
   grep -rniE "ADR[ -]?[0-9]{1,4}|decisions/[0-9]{4}" src docs
   ```
   Note which removable ADRs are cited where (code comments especially).
3. **Diagnose.** Within scope, identify (a) same-topic clusters and (b) supersession chains. For each, decide the survivor and what content/references move.
4. **Propose, then confirm.** Present the plan — survivors, removals, content being folded in, and every reference to repoint — and get sign-off **before** any destructive edit. If nothing needs consolidating, say so and stop.
5. **Execute.** Merge content into survivors (preserving their thesis verbatim in spirit), delete the obsolete files, repoint every inbound reference (code + docs), and update the **README log table** (`docs/decisions/README.md`) to drop retired rows and fix titles/status.
6. **Verify.** Re-run the grep from step 2 — there must be zero references to retired numbers. Then `bun run check`. Confirm the README table matches the files on disk.
7. **Reconcile docs.** Delegate to the `librarian` subagent (defined in `.codex/agents/librarian.toml`) with a summary of what was consolidated so the rest of `/docs` stays consistent.

Report what merged, what was removed and why, and which references moved.
