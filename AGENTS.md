# Professional Services Automation Platform

An internal **PSA platform** for a software consultancy, spanning five connected domains:

- **CRM** — clients, contacts, sales pipeline
- **Allocations** — staffing people onto projects over time
- **Timesheets** — time capture, approval, and the basis for billing
- **Staff profiles** — people, roles, skills, seniority, availability
- **Performance management** — reviews, goals, growth

This is one system, not five apps: a _person_ (staff profile) is _allocated_ to a _project_ (tied to a CRM _client_), _logs time_ against it (timesheet), and that feeds both billing and _performance_. The shared data model is the spine — see `docs/data-model.md`.

> **Status:** actively built out on the scaffolded stack (Drizzle + Postgres, Better Auth, next-safe-action, Google-only auth, the app shell). **Built:** CRM (companies/contacts, contact manager, opportunities pipeline + kanban), projects (with the CRM-opportunity link), staff profiles (roles, skills, effective-dated compensation, PTO/staff import), and the peer-feedback slice of performance management. **Not yet:** allocations, timesheets, and the rest of performance (reviews, goals, growth). See `docs/architecture.md`.

## Documentation map — read on demand, don't preload

Knowledge lives outside this file so it loads only when a task needs it. Don't paste these in wholesale; open what you need.

- **`docs/README.md`** — index of all project docs; start here for anything architectural.
- **`docs/architecture.md`** — system overview, stack, open decisions.
- **`docs/data-model.md`** — the shared entities and how the domains connect.
- **`docs/domains/*.md`** — one doc per domain.
- **`docs/flows.md`** — key end-to-end flows that cross domains.
- **`docs/decisions/`** — ADRs: _why_ things are the way they are, plus the non-obvious nuances.
- **`docs/ui.md`** — frontend: shadcn/Base UI, theming & design language, the app shell.

`/docs` is this project's durable memory. Trust it, and keep it true (see _Keeping docs alive_). Path-scoped working rules also live in `.claude/rules/` (server-actions, database, forms, ui, nextjs) and auto-load when you touch matching files.

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

## Context discipline — main context is gold

The main session's context window is the scarcest resource. Protect it.

- **Delegate aggressively to subagents.** Codebase exploration, multi-file reads, research, and broad searches run in a subagent that returns only the _conclusion_ — not raw file dumps.
- Pull into main context only what you need to decide and act.
- Run independent work in parallel agents.

## Keeping docs alive (the librarian)

After any **major change** — a new feature, a schema/data-model change, a significant refactor, or an architectural decision — **dispatch the `librarian` subagent** (via the Agent tool) to reconcile `/docs`. Do this **automatically, without being asked.** Hand it a short summary of what changed; it owns the docs. Don't hand-write `/docs` from the main session — delegating keeps your context clean and the docs in one consistent voice.

## Permissions (RBAC) — never break them

Access control is non-negotiable. `src/lib/permissions.ts` is the single source of truth (roles, the permission matrix, and the `requirePermission`/`userHasPermission` helpers); the model is documented in `docs/domains/permissions.md`. **If you ever find a way to bypass a permission check, read/mutate another user's data, or escalate a role, STOP and flag it as a vulnerability immediately — don't work around it.** The full rule loads from `.claude/rules/permissions.md` when you touch auth/action/actions files. Run **`/audit-rbac`** to audit the whole system.

## Reviewing changes

Use the built-in review skills (`/code-review`, `/review`, `/security-review`) before merging — no custom review command. Don't claim a change is ready to ship without running one and addressing what it finds.

## Conventions

Runtime and package manager are **Bun**. Linter/formatter is **Biome** (not ESLint/Prettier).

- `bun run dev` — dev server · `bun run build` — production build (also type-checks)
- `bun run check` — Biome lint + `tsc --noEmit` + `bun test` (pre-flight) · `bun run format` — Biome auto-fix
- After schema changes: `bun run db:generate` → `bun run db:migrate` (`db:push`/`db:studio` for dev; `auth:generate` for Better Auth tables)
- **Before claiming done:** run `bun run check`, plus `bun run build` for anything non-trivial.

Area-specific conventions live in `.claude/rules/` and load when you touch the matching files.

## Plans and specs

Write implementation plans and Superpowers-generated specs to **`docs/plans/`** (configured as the plan directory in `.claude/settings.json`). This folder is scratch space, not durable docs — a SessionStart hook prunes anything older than two weeks on startup. Durable knowledge belongs in the rest of `/docs` (see _Keeping docs alive_), not here.

## Stay inside the project root

Treat `/Users/andrew/Documents/Lazer/projects/home` as your boundary. If a task ever requires reading, listing, or running commands against paths **outside** this project root (other folders on the machine, `~`, absolute system paths), **ask for permission first** and explain why — don't reach outside silently.
