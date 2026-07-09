# Project documentation

The durable knowledge base for the PSA platform — maintained by the `librarian` subagent and trusted by future Claude Code sessions. If something here contradicts the code, the code wins: flag it and fix the doc.

## Map

| Doc | Covers |
|-----|--------|
| [development.md](./development.md) | Runbook: prerequisites, env setup, first run, the verify loop, schema workflow |
| [architecture.md](./architecture.md) | System overview, committed tech stack, `src/` layout, auth, authz, running the DB, modified-Next.js deltas |
| [ui.md](./ui.md) | Frontend: component library, theming/tokens, route-group auth gating, app shell, error/404/loading conventions |
| [data-model.md](./data-model.md) | Core entities, how the five domains connect, and what's realized in code |
| [flows.md](./flows.md) | Cross-domain flows, the auth flow, + the technical request flow every mutation follows |
| [domains/crm.md](./domains/crm.md) | Companies (clients + partners), contacts, sales pipeline |
| [domains/projects.md](./domains/projects.md) | Projects (client engagements) + delivery managers + role/staffing lines |
| [domains/allocations.md](./domains/allocations.md) | Staffing people onto projects over time |
| [domains/timesheets.md](./domains/timesheets.md) | Time capture, approval, billing basis |
| [domains/staff-profiles.md](./domains/staff-profiles.md) | People, roles, skills, compensation, availability |
| [domains/performance.md](./domains/performance.md) | Peer feedback (built); reviews, goals, growth (proposed) |
| [domains/permissions.md](./domains/permissions.md) | RBAC: permission model, role→permission matrix, enforcement layers, helpers |
| [decisions/](./decisions/) | Architecture Decision Records — the *why* |

## How these docs stay current

After any major change, the main agent dispatches the **librarian** subagent (`.claude/agents/librarian.md`) to reconcile these docs with the code. Decisions and non-obvious nuances become ADRs in [decisions/](./decisions/).

## Conventions for writing here

- Write for a future Claude session: "what do I need to know to work here safely and fast."
- Capture the **why**, not just the what.
- Keep it lean; link instead of repeating.
- Mark anything not yet built as **Status: proposed** or **planned**.
