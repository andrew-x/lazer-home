# Professional Services Automation Platform

An internal **PSA platform** for a software consultancy, spanning five connected domains:

- **CRM** — clients, contacts, sales pipeline
- **Allocations** — staffing people onto projects over time
- **Timesheets** — time capture, approval, and the basis for billing
- **Staff profiles** — people, roles, skills, seniority, availability
- **Performance management** — reviews, goals, growth

This is one system, not five apps: a _person_ (staff profile) is _allocated_ to a _project_ (tied to a CRM _client_), _logs time_ against it (timesheet), and that feeds both billing and _performance_. The shared data model is the spine — see `docs/data-model.md`.

> **Status:** actively built out on the scaffolded stack (Drizzle + Postgres, Better Auth, next-safe-action, Google-only auth, the app shell). **Built:** CRM (companies/contacts, contact manager, opportunities pipeline + kanban), projects (with the CRM-opportunity link **and their commercial layer — a fixed-fee or time-and-materials budget; a code-owned rate card keyed *line of business × discipline* (a default plus a `Partial` exceptions map, read only via `billRateFor`) whose figures are **snapshotted onto each role** as an editable `project_roles.billRate`, so revising the card prices only *future* roles and the margin math never reads it — an "off standard rate" marker is *derived* per role, deliberately conflating "negotiated" with "the card moved" because stale prices are now the failure mode worth surfacing; and plan revenue/cost/margin whose *cost* half is gated on the `projects.viewMargin` capability because it's derived from individual compensation, while rates and the fixed-fee **hourly-value comparator** (the same roles priced hourly, so a fee reads as a discount or premium — uncoloured, since a negotiation isn't a loss) stay ungated (ADR 0066)** — **and delivery notes: dated write-ups each carrying a 1–10 project-health rating, whose *latest* note drives the health metric and a `lowHealth` tag on the projects list; unlike margin that reaches every viewer, and writes sit on `projects.edit` with edit/delete deliberately **not** author-only, since a delivery note is a shared operational record (ADR 0059)**), staff profiles (roles, skills, effective-dated compensation, effective-dated L0–L4 rating levels, PTO/staff import, **and an org-chart view of the reporting line at `/staff?view=org` — read-only; `staff.managerId` stays import-only because editing it would grant review-note access**), timesheets (weekly time capture with a draft→submitted lifecycle), the allocations planner (day/week/month grid over project roles, with PTO availability, manager-only allocation notes, **and a per-cell remaining-capacity meter — the first cross-project load summing and over-allocation flagging: capacity is `100 − away` so PTO nets out, confirmed + tentative both consume it, and it runs on a *second*, prorated/uncapped load function added alongside the un-prorated display rate rather than replacing it (ADR 0060)**), **the home dashboard at `/` — two bands on *deliberately different time bases*: "Your Status" is **year to date** from submitted timesheets, "Lazer Status" is **point in time** from the `project_roles` plan (staffing = people on a *confirmed* role today; leave doesn't un-staff them; no timesheets at all, so thin submission can't read as an idle bench), which is why every figure must name its window and the bare word "utilization" is banned there — it's also the first client JS on that route, so its payload is whitelisted field-by-field to keep `allocationNotes`/`skills` off the wire (ADR 0063) — plus a personal task list inside "Your Status": every CRM task assigned to you, searchable and filterable, tick-to-complete, stale-flagged past a week, with an archive dialog for the full history. It's point-in-time state sitting beside YTD figures, so the band description names no single window and each block names its own instead; and it's why `setTaskDone` alone among the task actions has an owner path — the assignee may always complete their own task, anyone else still needs `crm.edit`, with no new capability and no matrix change (ADR 0065)** — **and the sales pipeline, now in *both* bands: open-deal counts across three funnel bands (Maturing deliberately excluded as a holding pen, so the bands don't sum to the board), each deal's size *borrowed* from its linked project's plan revenue (there is no `opportunities.value` column, so per-deal and per-band value genuinely mean two things — labelled "project plan value" and "counted once per project", not solved), and closed-won/lost counts for the week and month off a new nullable `opportunities.closedAt` (non-null exactly when the status is terminal under a shape CHECK, written by three writers through one pure transition table — `updatedAt` was an unsound proxy and no status history exists anywhere). Windowed figures inside a point-in-time band, so each block names its own window *as dates* (a Monday-start week can begin in the previous month, so "this week" isn't inside "this month"), the org payload is pre-folded per line of business instead of shipping deal rows, and it stays ungated because it reads plan **revenue** and never cost (ADR 0069, amending ADR 0063 twice)**, **the utilization report at `/reporting/utilization` — the only surface reconciling the `project_roles` plan against submitted-timesheet actuals: both series are always computed and never summed, but a `Planned | Logged` basis toggle renders **one at a time** and spends the other on deviation flags (≥20% *and* ≥8h from plan); `confirmed` roles only, so it and the planner's meter deliberately disagree; open to every signed-in user because the *Planned* half only re-aggregates what the planner already discloses, while the **whole *Logged* basis is gated on `timesheets.edit` cohort-wide** — no timesheet row is read at all without it, not even your own, and every logged figure is `null`, never `0` (ADR 0062, reshaped by ADR 0064)**, **Slack channel links — a private `l-scoping-*` channel on an opportunity and a public `l-project-*` channel on a project, each a denormalized column pair (no link table) managed only on that record's own surface, with create/link/unlink plus an inline suggestion. Three things to know before touching it: it runs on **one workspace bot token**, so `groups:read` sees only private channels the app was `/invite`d to and scoping-channel search is *structurally incomplete* (stated in the UI, not worked around); the gate is `metadata.authorize` resolving the capability from the channel kind — `crm.edit` and `projects.edit` are **disjoint**, so **no capability and no matrix change**; and creation is not transactional with the DB write while Slack has no delete, hence the ordering (invitees resolved *before* the irreversible call, `conversations.archive` as the compensating action, invites last and best-effort). Also the repo's first cache tags, using `updateTag` not `revalidateTag` (ADR 0067)**, **the finance report at `/reporting/finance` — the portfolio view of the commercial layer, and the first surface answering "what is the book worth this window, at what margin, at what blended rate". **Everything is plan, nothing is invoiced:** `time_entries.projectId` points at a *project*, never a `project_role`, so no hour is ever attached to the rate it would bill at and there is deliberately no `Planned | Logged` toggle. A fixed fee is **prorated by billable hours** into the window — refining ADR 0066 (a fee is attributable to *time*, still never to a *role*) and defined by the property that contiguous windows partition it exactly — and the share **always divides by the whole plan, never the slice**, or a line-of-business filter claims the entire fee for one practice. It is **one margin engine called twice** (clip role dates, scale the fee, call the existing `computeProjectMargin` — zero changes there), so it can't disagree with a project's own budget panel; all aggregation is **server-side in both currencies**, unlike the utilization report, because a role's cost ÷ its hours *is* that person's hourly comp; and it's gated on the existing `projects.viewMargin` with **no new capability and no matrix change** (ADR 0070)**, and the peer-feedback, review-notes, compensation-dashboard and compensation-change-plan slices of performance management (a plan proposes comp for a cohort and, on commit, writes the ratings — never the pay; Rippling stays the system of record), **plus staff self-evaluations — a person's own dated questionnaire, stored with a per-answer section/prompt snapshot so reworded questions never restate an old answer; own always readable *and* writable, anyone else's read-only behind `ratings.view`, writes author-only with no admin override (ADR 0058)**. **Not yet:** a real per-person capacity *model* (both the meter's and the report's baseline is a flat 8h × Mon–Fri week for everyone — `utilizationTarget`, part-time hours, joiners/leavers within a day and holidays are all unmodelled) plus capacity rollups/sorting and conflict *resolution*, timesheet approval/billing, **invoiced/actual revenue — which needs a `time_entries → project_role` link before any hour can be priced; until then every money figure is the *plan***, forecast-vs-actual as a *workflow* (the reports measure the gap; nothing re-forecasts or writes back), weighted pipeline forecasting (no `opportunities.value` column, no per-stage probability — the dashboard prices a deal from its project's plan or calls it unpriced), anything Slack beyond the channel *link* (no messages, notifications, webhooks, archive-on-close or rename sync), and the rest of performance (review cycles, goals, growth). See `docs/architecture.md`.

## Documentation map — read on demand, don't preload

Knowledge lives outside this file so it loads only when a task needs it. Don't paste these in wholesale; open what you need.

- **`docs/README.md`** — index of all project docs; start here for anything architectural.
- **`docs/architecture.md`** — system overview, stack, open decisions.
- **`docs/data-model.md`** — the shared entities and how the domains connect.
- **`docs/domains/*.md`** — one doc per domain.
- **`docs/flows.md`** — key end-to-end flows that cross domains.
- **`docs/decisions/`** — ADRs: _why_ things are the way they are, plus the non-obvious nuances.
- **`docs/guides/`** — **runbooks**: how to set up, configure and maintain the app (Slack app setup, etc.). Procedure, not knowledge — a guide states a constraint and links to the ADR rather than arguing for it, and a domain doc links here rather than growing install steps. When the two disagree the **guide wins**: it's what someone follows while something is broken. See `docs/guides/README.md`.
- **`docs/ui.md`** — frontend: shadcn/Base UI, theming & design language, the app shell.

`/docs` is this project's durable memory. Trust it, and keep it true (see _Keeping docs alive_). Path-scoped working rules also live in `.claude/rules/` (server-actions, database, forms, ui, nextjs). In **Claude Code** they auto-load when you touch matching files; in **Codex** and **opencode** the same rules are duplicated as nested `AGENTS.md` files (`src/AGENTS.md` for Next.js/UI/forms, `src/actions/AGENTS.md`, `src/lib/db/AGENTS.md`) — Codex loads them by working directory, opencode eager-loads all three. Read the one for the area you're editing. See _Agent runtimes_ below.

## How we work together

Treat me as a capable but **fallible** partner, not a spec to execute literally.

- **Push back.** If a request has a flaw, a hidden edge case, a simpler path, or conflicts with an earlier decision, say so _before_ implementing. Silent compliance isn't helpful.
- **Surface assumptions.** If ambiguity matters, ask. If it doesn't, pick the sensible default and say which.
- **Be a collaborator.** Offer the better option you see even when I didn't ask.
- **Verify before claiming done.** Evidence — run it, read the output — before assertions.

## Improve this setup as you go

When the work reveals something reusable, propose capturing it instead of re-explaining it next session:

- A repeated instruction or correction → a **rule** (`.claude/rules/`) or an addition here.
- A repeatable procedure → a **command** (`.claude/commands/`) or **skill**.
- A delegable, self-contained job → a **subagent** (`.claude/agents/`).

## Agent runtimes (Claude Code + Codex + opencode)

This repo is wired for **three** coding-agent runtimes, kept in deliberate parity — **full duplication, not symlinks or references.** `AGENTS.md` (this file, plus the nested ones) is the shared brain all three read; everything else is mirrored per runtime:

| Concern | Claude Code | Codex | opencode |
|---|---|---|---|
| Project instructions | `CLAUDE.md` → `@AGENTS.md` | `AGENTS.md` (native) | `AGENTS.md` (native; prefers it over `CLAUDE.md`) |
| Path-scoped coding rules | `.claude/rules/*.md` (path-glob auto-load) | nested `src/**/AGENTS.md` (cwd-load) + permissions inlined below | nested `src/**/AGENTS.md`, eager-loaded via `instructions` + permissions inlined below |
| Runtime config | `.claude/settings.json` | `.codex/config.toml` | `.opencode/opencode.jsonc` |
| Docs-keeper subagent | `.claude/agents/librarian.md` | `.codex/agents/librarian.toml` | `.opencode/agent/librarian.md` |
| Commands / skills | `.claude/commands/*.md` | `.agents/skills/*/SKILL.md` | `.agents/skills/*/SKILL.md` (**shared with Codex** — discovered natively) + thin `.opencode/command/*.md` entry points |
| Command permissions | `.claude/settings.json` → `permissions` | `.codex/rules/default.rules` (Starlark `prefix_rule`) | `.opencode/opencode.jsonc` → `permission` |
| Lifecycle hooks | `.claude/settings.json` → `hooks` | `.codex/hooks.json` + `.codex/hooks/*.sh` | `.opencode/plugin/psa-hooks.js` (plugin, not a hooks file) |

Neither Codex nor opencode can lazily load a rule when it touches a matching file, so in both the security-critical **permissions** rule is inlined in full below (always in context).

- **Codex** builds its `AGENTS.md` chain **once at startup, walking repo-root → cwd**, so the other rules live at the common-ancestor directory of their scope and load by working directory.
- **opencode** reads the root `AGENTS.md` natively but won't reliably pick up the nested ones (it's normally launched from the repo root), and has no path-glob equivalent. So the three nested rule files are **eager-loaded** via `instructions` in `.opencode/opencode.jsonc` — always in context, at a cost of ~19KB. Deliberate: a silently-missed convention is worse than the tokens.

**Skills are the one deliberate exception to full duplication:** opencode scans `.agents/skills/` natively, so it and Codex share one copy of each skill body. The per-runtime part is only the entry point (`.claude/commands/*.md`, `.opencode/command/*.md`), kept to a one-line delegation so there's no procedure text to drift.

This exception is forced by opencode, not a style choice — **don't "fix" it by duplicating skills into `.opencode/skill/`.** Skill names must be unique across locations: with the same name in both `.agents/skills/` and `.opencode/skill/`, opencode silently keeps the `.agents/skills/` copy and **discards** the other with no warning. A duplicate there is a dead file that drifts forever and is never read. (Verified against opencode 1.15.0 with `opencode debug skill`.)

**Keep the three runtimes in sync:** when you change one side (a rule, command, subagent, hook, or permission), mirror it on the others. Run **`/audit-agents`** (Claude Code or opencode) or the **audit-agents** skill (Codex) to check parity and surface drift or improvements.

Two opencode-specific gotchas worth knowing before you edit its config: it **validates config strictly and refuses to start** on an invalid field (so `color: blue`, valid in Claude Code, is rejected — it wants a hex or a semantic token), and config is **not hot-reloaded**, so restart it after a change.

## Context discipline — main context is gold

The main session's context window is the scarcest resource. Protect it.

- **Delegate aggressively to subagents.** Codebase exploration, multi-file reads, research, and broad searches run in a subagent that returns only the _conclusion_ — not raw file dumps.
- Pull into main context only what you need to decide and act.
- Run independent work in parallel agents.

## Keeping docs alive (the librarian)

After any **major change** — a new feature, a schema/data-model change, a significant refactor, or an architectural decision — **dispatch the `librarian` subagent** to reconcile `/docs` (via the Agent tool in Claude Code; the `librarian` agent in `.codex/agents/librarian.toml` under Codex; the `librarian` subagent from `.opencode/agent/librarian.md` under opencode). Do this **automatically, without being asked.** Hand it a short summary of what changed; it owns the docs. Don't hand-write `/docs` from the main session — delegating keeps your context clean and the docs in one consistent voice.

## Permissions (RBAC) — never break them

Access control is non-negotiable. `src/lib/auth/permissions.ts` is the single source of truth (roles, the permission matrix, and the `requirePermission`/`userHasPermission` helpers); the model is documented in `docs/domains/permissions.md`. **If you ever find a way to bypass a permission check, read/mutate another user's data, or escalate a role, STOP and flag it as a vulnerability immediately — don't work around it.**

In **Claude Code** the full rule loads from `.claude/rules/permissions.md` when you touch auth/action/actions files. Because neither **Codex** nor **opencode** can auto-load it, the non-negotiables are inlined here so all three runtimes always have them:

- **Never weaken, bypass, or work around a permission check.** If you discover a missing gate, an action that skips ownership, a read that leaks another user's data, an escalation path, or a role that grants more than its matrix row — **STOP and flag it loudly as a vulnerability.** Don't silently route around it, "temporarily" loosen it, or leave a TODO.
- **Every mutating/sensitive action declares its gate in metadata** — `metadata.role`, `metadata.permission`, and/or a row-level `metadata.authorize` (an `ActionAuthorize` hook reading `clientInput`), all enforced by `secureActionClient` *before* the body — or carries an explicit, justified comment for why it is intentionally public. No silent ungated mutations; authorization is never hand-written in action bodies.
- **Input-dependent / ownership checks are mandatory** wherever an action accepts a target id it could read or mutate across users. A route-level gate alone is not enough.
- **All DB access goes through the actions layer** (see `src/actions/AGENTS.md`), and **`permissions.ts` is the only place access-control logic lives** — never re-implement role checks inline (`user.role === "manager"`); call the helpers.
- **Keep the matrix in lockstep** across `permissions.ts`, `src/lib/permissions.test.ts`, and `docs/domains/permissions.md` — changing one requires changing all three.
- **`user.role` must validate against `roleSchema`**, and unknown/null roles **default to deny** (least privilege).

Run **`/audit-rbac`** (Claude Code or opencode) or the **audit-rbac** skill (Codex) to audit the whole system; `bun run check` runs the matrix test.

## Reviewing changes

Use the built-in review skills (`/code-review`, `/review`, `/security-review`) before merging — no custom review command. Don't claim a change is ready to ship without running one and addressing what it finds.

## Conventions

Runtime and package manager are **Bun**. Linter/formatter is **Biome** (not ESLint/Prettier).

- `bun run dev` — dev server (**you never run this — see _Never run the app_**) · `bun run build` — production build (also type-checks)
- `bun run check` — Biome lint + `tsc --noEmit` + `bun test` (pre-flight) · `bun run format` — Biome auto-fix
- After schema changes: `bun run db:generate` → `bun run db:migrate` (`db:push`/`db:studio` for dev; `auth:generate` for Better Auth tables). **Then update `scripts/seed/` to match** — the synthetic-data seed (`bun run db:seed`, reads `DATABASE_URL`, wipes & reseeds every domain) imports the real Drizzle tables and enum sources, so a stale seed shows up as a `bun run check` failure. Keep it green when you touch the data model.
- **Before claiming done:** run `bun run check`, plus `bun run build` for anything non-trivial.

Area-specific conventions live in `.claude/rules/` (Claude Code) and the nested `src/**/AGENTS.md` files (Codex, opencode) — see _Agent runtimes_.

## Never run the app

**Running the app is mine, not yours.** I keep a dev server going myself; a second one fights over the port, over `.next/`, and over the shared dev database, and a server you start in the background outlives the turn and silently rots.

- **Never** start, restart, or drive the app: no `bun run dev`, `bun run start`, `next dev`, `next start`, no `bunx next …` equivalents, no wrapping them in another command, and no launching them in the background or through a hook or script that ends up doing the same thing.
- Don't invoke the `/run` skill on this project, and don't browser-drive or screenshot a running instance. If you genuinely need runtime evidence, **say what you want checked and ask me to run it** — I'll run it and paste the result.
- **Verify without running:** `bun run check` (Biome + `tsc --noEmit` + `bun test`) and `bun run build` are your evidence, and both are expected before you claim done. `bun run build` is a compile, not a server — it's fine.
- Applies to subagents too: don't delegate "just start the dev server and look" to one.

This is a hard rule, not a preference, so all three runtimes also **deny** the dev-server commands at the permission layer (`.claude/settings.json`, `.codex/rules/default.rules`, `.opencode/opencode.jsonc`). If you hit that denial, that's this rule firing — ask me instead of hunting for a way around it.

## Plans and specs

Write implementation plans and Superpowers-generated specs to **`docs/plans/`** (configured as the plan directory in `.claude/settings.json`). This folder is scratch space, not durable docs — a SessionStart hook prunes anything older than two weeks on startup. Durable knowledge belongs in the rest of `/docs` (see _Keeping docs alive_), not here.

## Stay inside the project root

Treat `/Users/andrew/Documents/Lazer/projects/home` as your boundary. If a task ever requires reading, listing, or running commands against paths **outside** this project root (other folders on the machine, `~`, absolute system paths), **ask for permission first** and explain why — don't reach outside silently.
