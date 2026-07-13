---
name: audit-library
description: Use when you want to audit /docs against the code — verifying every doc is accurate and current and flagging significant code↔doc discrepancies for you to adjudicate. Read-only; never edits.
---

# Audit the library

Verify that the `/docs` knowledge base still tells the truth about the code. This is
a **read-only audit** — investigate and report; do **NOT** edit any docs or code.

Crucially, this is *not* the normal librarian reconcile pass. When the librarian is
dispatched after a change, it assumes the code is right and updates the docs to
match. Here we assume **nothing**: when a doc and the code disagree, either could be
the correct one — the doc may be stale, or the code may have drifted from a
deliberate decision the doc still records. Your job is to **surface the conflict, show
both sides, and let me decide** whether the doc or the code should change. Do not
"fix" it by silently rewriting the doc.

If the user named a scope when invoking this skill (a doc or area, e.g. "crm" or
"data-model"), audit only that scope; otherwise audit every doc under `/docs`.

## Ground truth

- **`docs/README.md`** — the index of every doc and what it's supposed to cover.
  Start here; the map itself is auditable (missing entries, docs that no longer exist).
- **`AGENTS.md`** — the top-level description of the system; docs must not contradict it.
- The **code** is the arbiter of *what the system does today*. The **ADRs**
  (`docs/decisions/`) are the arbiter of *what we decided and why* — a doc that
  contradicts a still-current ADR is a finding even if the prose reads fine.

## How to run it — delegate to the librarian, then synthesize

Main context is gold, and the librarian owns `/docs`. **Delegate to the `librarian`
subagent (defined in `.codex/agents/librarian.toml`) in read-only audit mode** — do
not read the whole tree yourself. For coverage and speed, run **one librarian per doc
(or doc group)** in parallel, each scoped to a single doc and told to:

- **Audit only — write nothing.** Explicitly instruct it not to use Write/Edit this
  run. It verifies; it does not reconcile.
- Read its assigned doc, then read enough of the code the doc describes to check each
  concrete claim against reality (`git log --oneline -20` and `git diff` help spot
  recent drift).
- Return a **structured list of findings only** — not file dumps — where each finding
  is: the doc claim (`doc:line`), what the code actually does (`file:line`), the
  severity, and — for significant ones — which side looks wrong and why.

If a scope was named, only dispatch librarians for the matching docs. Then synthesize
their conclusions into the single report below.

## What to check in each doc

1. **Factual accuracy.** Does every concrete claim — entities, fields, flows, file
   paths, function/action names, the stack, config — still match the code? Flag
   claims that are now false.
2. **Currency / staleness.** Is anything described that no longer exists, or missing
   that now does? Watch the `Status:` markers (`proposed` / `planned` / `built`) —
   flag things marked planned that are now built, or described-as-built that aren't.
3. **Decision integrity.** Does the doc contradict a current ADR, or describe a
   choice a later ADR superseded? Cross-check `docs/decisions/`.
4. **Index honesty.** Does `docs/README.md` list every doc that exists and no doc
   that doesn't? Does each doc actually cover what the map says it covers?
5. **Internal consistency.** Do docs contradict each other or `AGENTS.md`
   (e.g. two docs describing the same flow differently)?

## Distinguish the trivial from the significant

- **Trivial drift** — a renamed file, a moved path, a wording nit, an outdated
  `Status:` marker. The doc is simply behind; the fix is obviously "update the doc."
  Group these tersely.
- **Significant discrepancy** — the doc and the code describe **materially different
  behavior, data shapes, or decisions**, such that it's genuinely unclear which is
  correct: the code may have drifted from an intended design, or a documented decision
  may have been quietly violated. **These are the ones I need to adjudicate.** For each,
  present:
  - **What the doc says** (`doc:line`, quoted).
  - **What the code does** (`file:line`).
  - **Why it matters** and your read on which is likely wrong.
  - **The decision for me:** _update the doc_ (code is right) or _change the code_
    (doc/decision is right) — recommend one, but don't act on it.

## Output

A single report:

- **🔴 Significant discrepancies — needs your decision.** List first, most consequential
  first, each in the doc-says / code-does / your-call format above. This is the point of
  the command.
- **🟡 Stale but clear.** Docs plainly behind the code where the fix is unambiguous
  (update the doc). Terse list of `doc:line` → what changed.
- **🟢 Index & consistency nits.** README map gaps, cross-doc contradictions, `Status:`
  markers to flip.
- **✅ Verified accurate.** Which docs you checked and found trustworthy — so I know the
  audit was real and what I can still rely on.

End with a one-line verdict on overall doc health and, if there are 🔴s, a reminder that
**nothing was changed** — once I decide each call, I can have the `librarian` apply the
doc updates (and open code fixes separately). **Do not modify any files.**
