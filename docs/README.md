# Project documentation

The durable knowledge base for the PSA platform — maintained by the `librarian` subagent and trusted by future Claude Code sessions. If something here contradicts the code, the code wins: flag it and fix the doc.

## Map

| Doc | Covers |
|-----|--------|
| [development.md](./development.md) | Runbook: prerequisites, env setup, first run, the verify loop, schema workflow, synthetic-data seed (`db:seed`) |
| [architecture.md](./architecture.md) | System overview, committed tech stack, `src/` layout, auth, authz, running the DB, modified-Next.js deltas |
| [ui.md](./ui.md) | Frontend: component library, theming/tokens, route-group auth gating, app shell, error/404/loading conventions, the **home dashboard** (two bands, two time bases — plus the personal **Tasks** block, whose point-in-time state is why *Your Status* names no single window) |
| [data-model.md](./data-model.md) | Core entities, how the five domains connect, and what's realized in code |
| [flows.md](./flows.md) | Cross-domain flows, the auth flow, + the technical request flow every mutation follows |
| [domains/crm.md](./domains/crm.md) | Companies (clients + partners), contacts, sales pipeline, and **tasks** — including the **personal task list on `/`** (the one non-parent-scoped task surface) and the domain's single ownership gate: the **assignee may always complete** their own task |
| [domains/projects.md](./domains/projects.md) | Projects (client engagements) + delivery managers + role/staffing lines + **budgets, rate cards and plan margin** (cost/margin gated on `projects.viewMargin`) + the list's **derived risk tags** (code-owned thresholds, judged in CAD) + **delivery notes** (dated write-ups with a 1–10 health rating; list health derived from the latest note, ungated) + the `/projects` list itself: a **sortable, server-ordered table under status tabs** (nulls last both ways; margin *ordering* gated like the figures) |
| [domains/allocations.md](./domains/allocations.md) | Staffing people onto projects over time; the `/allocations` planner view (built) + its manager-only inline notes + the per-cell **remaining-capacity meter** (cross-project load, PTO netted out, over-allocation flagged — but **not** a capacity model) + the home dashboard's **"Lazer Status"** band: the same read as a *point-in-time* org snapshot (staffed-today headcount, availability by week, upcoming/unfilled roles, cross-LoB lending) |
| [domains/timesheets.md](./domains/timesheets.md) | Weekly time capture (built); approval + billing deferred; the **year-to-date personal utilization** behind the home dashboard's Your Status tiles |
| [domains/utilization.md](./domains/utilization.md) | The **Utilization report** (`/analytics/utilization`, built) — plan vs. actuals as two never-summed series behind a **`Planned \| Logged` basis toggle** (the off-screen series drives **deviation flags**); confirmed roles only; open page, but the whole **Logged basis is gated cohort-wide on `timesheets.edit`**; plus the table distinguishing the **three surfaces** that say "utilization" over three different windows |
| [domains/staff-profiles.md](./domains/staff-profiles.md) | People, roles, skills, compensation, availability; the **viewer-dependent** profile tab set (5–8 tabs), the read-only profile drawer (3–9), the `/staff` **org chart** view + the `/people/profile-completeness` table |
| [domains/performance.md](./domains/performance.md) | Peer feedback (incl. the per-person profile tab) + the three **Analytics** dashboards (`/analytics/compensation`, `/analytics/bonuses`, `/analytics/levels` — separately gated, aggregate & anonymized) + the **People management** screens (`/people/levels`, `/people/compensation-plans`, `/people/bonus-payments` — plus staff's read-only `/people/profile-completeness`; both section indexes are redirects) + staff rating levels L0–L4 with per-role subratings + compensation change plans + **performance review notes** + **bonus payments** (`staff_bonus_payment` — dated payments, date-of-payment attribution, the type × LoB/role matrix) + **staff self-evaluations** (built); review cycles, goals, growth (proposed) |
| [domains/permissions.md](./domains/permissions.md) | RBAC: permission model, role→permission matrix, enforcement layers, helpers — **plus everything outside the matrix**: ownership paths (now in four domains, incl. `crm.edit`'s one owner path — completing a task assigned to you), composite gates, the one *relationship* gate (review notes), and a capability *with* a full owner path + author-only writes (self-evaluations) |
| [decisions/](./decisions/) | Architecture Decision Records — the *why* |

## How these docs stay current

After any major change, the main agent dispatches the **librarian** subagent (`.claude/agents/librarian.md`) to reconcile these docs with the code. Decisions and non-obvious nuances become ADRs in [decisions/](./decisions/).

## Conventions for writing here

- Write for a future Claude session: "what do I need to know to work here safely and fast."
- Capture the **why**, not just the what.
- Keep it lean; link instead of repeating.
- Mark anything not yet built as **Status: proposed** or **planned**.
