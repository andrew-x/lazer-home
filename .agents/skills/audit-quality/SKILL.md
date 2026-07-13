---
name: audit-quality
description: Use when you want to audit code craft — consistency, DRY, organization, extensibility, and staff-level quality across the codebase. Read-only; reports findings and proposed fixes.
---

# Audit code quality

Assess the codebase against the bar we hold ourselves to: **code a staff-level
engineer would be happy to own.** Well written, consistent with our established
patterns, DRY, well organized, and easy to extend. This is a **read-only audit** —
investigate and report; do NOT change any files. Findings become a prioritized
punch list, not inline edits.

If the user named a scope when invoking this skill (a domain or path, e.g. "crm" or
"src/actions/crm"), audit only that scope; otherwise audit the whole `src/` tree.

## Ground truth — read these first

Quality here means *consistent with our conventions*, not generic best practice.
Load the standards before judging anything against them:

- **`AGENTS.md`** + **`docs/architecture.md`** — the stack, the shape of the system,
  and open decisions.
- **`.claude/rules/`** — the path-scoped working rules: `server-actions.md`,
  `database.md`, `forms.md`, `ui.md`, `nextjs.md` (mirrored for Codex in the nested
  `src/**/AGENTS.md` files and, for permissions, in the root `AGENTS.md`). These are
  the concrete "how we write X here" contracts. A deviation from a rule is a finding.
- **`docs/decisions/`** — the *why*. Don't flag something as wrong if an ADR
  deliberately chose it; cite the ADR instead.

## Out of scope — don't duplicate other audits

- **Security / access control / RBAC** → that's `audit-rbac` and `security-review`.
  If you spot a permissions bypass, flag it loudly and point at those, but don't do
  their job here.
- **Correctness bugs in a specific diff** → that's `code-review`.

This command is about **craft and structure**, not exploitable defects.

## How to run it — delegate, then synthesize

Main context is gold. Don't read the whole tree yourself. **Delegate the dimensions
below to Codex subagents in parallel** (e.g. the built-in `explorer` agent for
read-heavy exploration), asking Codex to fan out the dimensions concurrently. Scope
each agent to one dimension and instruct it to return only a structured list of
findings (`file:line`, what, why it matters, suggested fix, severity) — not file
dumps. Then synthesize their conclusions into one report. If a scope was named, pass
that scope to every agent.

## Dimensions

1. **Pattern consistency.** Do similar things look similar? Server actions, forms,
   data access, and UI components should each follow the single shape defined in the
   matching `.claude/rules/` file. Flag one-off deviations, parallel implementations
   of the same idea that drifted apart, and files that predate a convention and were
   never brought in line.

2. **Duplication (DRY).** Copy-pasted logic, near-identical components/actions that
   should share a helper, repeated literals/constants, hand-rolled versions of
   something a shared util already does. Distinguish *incidental* duplication (leave
   it) from *knowledge* duplication (one concept expressed in N places — fix it).
   Don't recommend an abstraction that would couple genuinely-unrelated code.

3. **Organization & colocation.** Is each thing where a new engineer would look for
   it? Check the layering (actions vs lib vs components vs pages), colocation of
   related files, module boundaries, and barrel/import hygiene. Flag misplaced logic
   (e.g. business rules in components, DB access outside the actions/lib layers),
   god-files, and directories that have outgrown their structure.

4. **Extensibility & abstraction fit.** Would adding the next client, domain, role,
   or field be a small, obvious change — or a shotgun edit? Flag missing seams,
   leaky abstractions, and hardcoding that will bite on the next addition. Equally
   flag **over-abstraction**: premature generalization, indirection with a single
   caller, config for things that never vary. The right altitude, not the most.

5. **Readability & naming.** Names that say what they mean; functions that do one
   thing; control flow that reads top-to-bottom without decoding. Flag misleading
   names, cleverness that costs clarity, deep nesting that early-returns would flatten,
   and comments that explain *what* instead of *why* (or that lie).

6. **Type safety & data boundaries.** This is a TypeScript + Drizzle + Zod +
   next-safe-action codebase — lean into it. Flag `any`, unsafe casts (`as`),
   non-null `!` bangs papering over real nullability, untyped boundaries, and input
   that crosses a trust boundary without a Zod schema. Prefer inferred/derived types
   over hand-maintained duplicates of the schema.

7. **Error & edge handling.** Consistent, intentional handling of failure, empty,
   and loading states. Flag swallowed errors, unhandled promise rejections, missing
   empty/loading UI, and inconsistent error surfacing across similar code paths.

8. **Simplicity & dead code.** The best code is the code that isn't there. Flag
   unused exports/files/deps, commented-out blocks, speculative "might need it" code,
   redundant state, and anything more complex than the problem demands.

9. **Tooling & conventions.** Bun + Biome, not npm/ESLint/Prettier. Run
   `bun run check` (Biome + `tsc --noEmit`) and fold any lint/type findings in. Flag
   scripts/imports/config that fight the toolchain or ignore project conventions.

## Output

A single prioritized report:

- **🔴 Must fix** — real quality debt that will compound: broken conventions,
  knowledge duplication, misplaced logic, `any`/unsafe boundaries, missing seams
  that make extension painful. Most impactful first.
- **🟡 Should fix** — clear improvements that aren't yet hurting: naming, minor
  duplication, readability, dead code.
- **🟢 Nits** — polish and taste calls; group tersely.
- **✅ Strengths** — what's genuinely well built and worth preserving as the pattern
  to copy. Be honest, not flattering.

For every finding: `file:line`, the issue, *why it matters*, and a concrete
suggested fix. Group by dimension or by area — whatever makes the punch list easiest
to act on. End with a one-line verdict on overall health and the top 3 things to fix
first. **Do not modify any files** — if I want the fixes applied, I'll follow up
(or run `simplify` on a scoped diff).

### When a fix has more than one sensible approach

Some findings have a single obvious fix; others fork into genuinely different
approaches with real trade-offs (e.g. *extract a shared helper* vs *inline and delete
the abstraction*, *widen the Zod schema* vs *narrow the caller*, *colocate* vs *lift
to a shared module*). **Don't silently pick one and present it as the fix.** When the
choice is mine to make, lay out the viable approaches — each with its trade-off in a
line. Present the choice to the user as an explicit multiple-choice question and wait
for their answer before anything gets applied, with your recommended option first and
marked as such. Note which findings are blocked on my decision so the punch list stays
actionable. Reserve this for real forks — if one approach is clearly correct for our
conventions, just recommend it and cite the rule or ADR.

## Applying fixes (only if I ask)

The audit itself is read-only. If I follow up asking you to apply some or all of the
findings, first make sure every fix that forked (above) has a chosen approach — don't
start until the decisions are settled.

Then **apply independent fixes in parallel with subagents.** Group the approved
findings by what they touch, and delegate one Codex subagent per independent group,
each with a tight brief: the specific findings, the chosen approach, and the relevant
`.claude/rules/` contract (mirrored for Codex in the nested `src/**/AGENTS.md` files
and, for permissions, in the root `AGENTS.md`). Fixes that touch the same files, or
that depend on another fix landing first (e.g. extract a helper before its call sites
migrate), must go in the same group or run in sequence — don't let two agents edit the
same file concurrently. Keep genuinely unrelated work (a naming fix in `crm` and a
dead-code sweep in `settings`) on separate parallel agents. After the agents return,
run `bun run check` (and `bun run build` for anything non-trivial) yourself to verify
the combined result, and report what landed versus what's still pending a decision.
