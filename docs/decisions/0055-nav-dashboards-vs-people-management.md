# 0055 — Nav split by read-vs-write: `Dashboards` and `People management`; bonuses become their own dashboard

**Status:** accepted · 2026-07-30 · extends
[ADR 0044](./0044-performance-dashboards-split-by-permission.md) (which split the
merged `/performance` page into gated sibling routes; that decision stands — this one
regroups the result and moves the routes)

**TL;DR:** `Dashboards` = the three aggregate, anonymized, read-only analytics pages
(`/reporting/{compensation,bonuses,levels}`). `People management` = the three
identity-bearing write screens (`/people/{levels,compensation-plans,bonus-payments}`).
Both section indexes are permission-aware redirects. Bonuses stop being a section of
the Compensation dashboard and become a page. **No gate, read or schema changed.**

**Read this ADR through its amendments below.** As of 2026-08-03 the section is named
**`Reporting`** and lives at **`/reporting/*`**, and the axis is **read vs. write** — the
"aggregate and anonymized" framing (and the 2026-07-30 amendment built on it) is retired.

> **Amended, 2026-07-30 (same day) — ⚠️ SUPERSEDED by the 2026-08-03 amendment below;
> kept for the record, don't reason from it.** `People management` gained a **fourth** child,
> `/people/profile-completeness` — which is **read-only, and owned by the staff
> domain, not performance**. The dividing line the ADR actually draws is
> **aggregate-and-anonymized vs. about-named-individuals**, not read vs. write, so a
> named-person read belongs here rather than under Dashboards; read the section names
> as "aggregate analytics" and "per-person management screens". The redirect ladder
> takes the new branch **last** (all four gates are {manager, admin} today, so nobody's
> landing page moved). See
> [domains/staff-profiles.md](../domains/staff-profiles.md#profile-completeness-reportingprofile-completeness).

> **Renamed, 2026-08-03 (superseded hours later by the amendment below — the section is
> `Reporting` now, not `Analytics`).** The section was relabelled **`Analytics`** and moved to
> **`/analytics/*`** (`/dashboards/*` is gone, not redirected — nothing linked to it
> from outside the app). The route paths below have been updated in place; the word
> `Dashboards` is left as this ADR wrote it, so read it as `Analytics`. The split this
> ADR decided is unchanged; only the label and the URL segment moved. The same round
> **deleted `/settings`** (account info + sign out, both already elsewhere) and moved
> **Peer Feedback** above Companies in `NAV_ITEMS`; neither touches a gate.

> **Renamed again + axis changed, 2026-08-03.** Two related moves, both deliberate calls
> by the repo owner:
>
> 1. **The section is now labelled `Reporting` and lives at `/reporting/*`.** The route
>    directory moved (`git mv`, history preserved); `/analytics/*` is gone and **not
>    redirected**, the same precedent as `/dashboards/*` above — internal app, no external
>    links worth a rewrite layer. Every route in the tables below reads `/reporting/*` now,
>    and the label words `Dashboards`/`Analytics` are left as this ADR wrote them: read
>    `Dashboards` → `Analytics` → **`Reporting`**. `revalidatePath` literals moved with the
>    routes (`BONUS_READER_PATHS`, `commitCompensationPlan`, `saveStaffEvaluation`) — the
>    standing tax noted under *Consequences*, now paid a third time.
> 2. **The organizing axis is `read` vs. `write`** — which is what this ADR's title and
>    original *Decision* said, and what the 2026-07-30 amendment above talked itself out of.
>    **Reporting = every read-only workforce surface. People management = the write
>    surfaces** (assigning levels, proposing comp, recording payments). **Aggregate-vs-
>    per-person is no longer the line.** Most of Reporting *is* aggregate, but
>    **`/reporting/profile-completeness` is a named per-person read and sits there anyway,
>    because nothing in it writes.** It is Reporting's **fifth and last** child (after
>    Levels); People management drops to **three**.
>
> **The counter-argument this overturns** (so a future reader sees the trade, not just the
> outcome): profile completeness is owned by the **staff** domain, not performance, and its
> rows are about **named individuals** — under the 2026-07-30 framing that put it squarely
> with the per-person management screens. Overturned because the axis it appealed to had to
> be invented *for it*: "aggregate and anonymized" was already false of the section the
> moment that page joined, so the section name stopped predicting anything. Read-vs-write is
> checkable from the code (does this surface mutate?) and needs no exception. Cost accepted:
> Reporting is no longer safe to describe as anonymized, and a reader can no longer assume a
> Reporting page discloses no identities — **that claim is retired**, and any doc or comment
> leaning on it was updated in this round.
>
> **Permissions: nothing changed.** `PROFILE_COMPLETENESS_ACCESS` is still
> `{ staff: ["edit"] }`, still checked in the page (`notFound()`) *and* in
> `getProfileCompleteness` (`requirePermission`). No matrix row, capability, gate or read
> moved. **The one behavioural nuance:** the nav entry used to sit under the
> `{ ratings: ["edit"] }`-gated People-management parent, so a hypothetical `staff.edit`-only
> holder couldn't reach from the sidebar a page they were allowed to open; under the
> **ungated** Reporting parent the nav finally matches the page's own gate. `ratings.edit`
> and `staff.edit` have identical role rows ({manager, admin}) today, so **no one's actual
> access changed** — but the nav is now right for the reason, not by coincidence.
>
> **Two structural notes.** The Reporting parent stays **ungated**, still correct under
> *a parent is as loose as its loosest child* (Utilization is open to everyone) — so the
> parent-gate row in the table below reads `staff.viewCompensation` only as history; ADR 0062
> retired it. And the `/reporting` redirect ladder gets **no profile-completeness branch**:
> utilization is ungated, so the ladder can never fall through past it. The `/people` ladder
> lost its `PROFILE_COMPLETENESS_ACCESS` branch and is down to three.

## Context

ADR 0044 replaced one merged `/performance` page with sibling gated routes, and the
sidebar grew a single **Performance** submenu. Since then that submenu accumulated
everything the domain shipped: two dashboards, the levels-assignment grid,
compensation plans, and — as a *section* of the Compensation dashboard — the bonus
payments breakdown, with its entry screen reachable only via a button on that
dashboard, at `/performance/compensation/bonuses`.

Three problems had accumulated:

1. **One section mixed two kinds of surface.** ADR 0044's own framing is that the
   analytics pages are *aggregate and anonymized* — no identity leaves the server.
   But sitting beside them under the same parent were the three surfaces that are
   emphatically about named individuals: assigning someone a level, proposing
   someone's pay, recording a payment to someone. The sidebar said those were the
   same kind of thing. They are not, and the distinction is the security-relevant
   one this domain keeps making everywhere else.
2. **"Performance" had stopped naming the section's contents.** Read literally, a
   *Performance* section containing a compensation dashboard and a bonus-payments
   entry screen is misleading — and the word also collides with the domain's
   still-unbuilt review/goal machinery, which is what a reader expects to find there.
3. **The bonus breakdown was a section on a page it doesn't reconcile with.** Bonus
   totals count everyone paid during a calendar year, *including people who have
   since left*, while every table above them counted active staff. The component had
   to carry an on-screen caveat and a doc comment explaining that the two halves of
   one page deliberately don't add up. It also had to sit *outside* that page's
   "no staff match these filters" guard, because a filter emptying the headcount
   tables must not hide payments.

## Decision

**Group the domain's surfaces by whether they read aggregates or write about named
people, and give bonuses their own dashboard.**

| Section | Route | Gate |
|---|---|---|
| **Dashboards** (`IconChartBar`) | `/reporting` → redirect | `staff.viewCompensation` |
| | `/reporting/compensation` | (parent's) |
| | `/reporting/bonuses` | `BONUS_PAYMENT_READ_ACCESS` = `staff.viewCompensation` |
| | `/reporting/levels` | `ratings.view` |
| **People management** (`IconUserStar`) | `/people` → redirect | `ratings.edit` |
| | `/people/levels` | `ratings.edit` |
| | `/people/compensation-plans` (+ `[planId]`, `[planId]/staff`) | `COMPENSATION_PLAN_ACCESS` |
| | `/people/bonus-payments` | `BONUS_PAYMENT_WRITE_ACCESS` |

**Peer Feedback stays a top-level entry.** It is the one surface here open to every
active staffer (giving feedback needs no capability), so filing it under a
manager-gated section would be wrong about who it is for.

**The `/people` parent gate is `ratings.edit`, and that is exact, not approximate.**
ADR 0044 had to note that the Dashboards parent uses the section's *loosest* child
gate and is therefore valid only while a matrix relationship holds. `/people` is
stronger: every child gate resolves to exactly {manager, admin} today —
`ratings.edit` and `staff.edit` have identical role rows, and the two conjunctions
only add `viewCompensation`, which both roles already hold — so the parent gate
**equals** the union of its children and over-admits nobody. The redirect still walks
all three children in order rather than short-circuiting, so narrowing one child's
gate later can't silently drop a viewer onto a 404.

### The bonus dashboard

`/reporting/bonuses` is a page of its own with the same `staff.viewCompensation`
gate, now expressed through the **existing** `BONUS_PAYMENT_READ_ACCESS` constant
rather than a hand-written literal. `BonusDashboard` (`bonus-dashboard.tsx`) is a thin
shell: it owns `useDashboardFilters()`, renders `DashboardFilterBar` (with `rates` —
this page is money-dense) and the `canEditBonuses`-gated "Manage payments" link, then
hands the filter state to the unchanged `BonusBreakdown`, which owns every number.

Consequences that fall out of the split rather than being designed in:

- **The Compensation dashboard's page takes no `searchParams` at all** now. The
  `bonusYear` param, its validation, and the `getBonusSummaryData` call all left with
  the section.
- **One year param, not two.** The two bonus surfaces used different keys
  (`bonusYear` on the dashboard, `year` on the entry screen) purely because the
  dashboard shared a URL with the rest of compensation. Each now owns its whole page,
  so `BONUS_YEAR_PARAM` collapsed to `"year"` and `BONUS_MANAGER_YEAR_PARAM` is gone.
  (The module comment warning that this constant must **not** move into a
  `"use client"` file — the bundler would replace it with a client-reference proxy and
  the server page's `searchParams` lookup would silently miss forever — still stands.)
- **One year parser.** `parseBonusYear` was duplicated verbatim in both pages; it now
  lives once in `src/lib/staff/staff-bonus.ts` beside the param it validates.
- **The caveat text got shorter, not longer.** "Doesn't reconcile with the headcount
  *above*" became "with the headcount on the Compensation dashboard" — the awkwardness
  was a symptom of the layout, and moving the section fixed the sentence.

### Renames that follow

`performance-dashboard.tsx` → `levels-dashboard.tsx`, `PerformanceDashboard` →
`LevelsDashboard`, and its page `<h2>` "Performance dashboard" → "Levels dashboard".
With "Performance" gone from the UI, a component named for it described nothing.

**The source directories `src/{lib,actions,components}/performance/` and
`docs/domains/performance.md` deliberately did NOT move.** Performance management is
still the domain; only the nav labels and route segments changed. Renaming the domain
would be a much larger, purely cosmetic diff, and "performance management" remains the
right name for the thing that will eventually hold reviews, goals and growth.

## Consequences

- **The nav now encodes the read/write boundary**, the same way ADR 0044 made the
  route structure encode the permission boundary. A new aggregate analytics page goes
  under Dashboards; a new per-person editor goes under People management. The question
  "which section?" has an answer that isn't a judgement call.
- **Old URLs 404.** `/performance/**` is gone with no redirects or rewrites. Accepted:
  this is an internal app with no external links or bookmarks worth preserving, and a
  rewrite layer for six routes nobody links to is dead weight.
- **`revalidatePath` targets moved again** — `bonusPaymentMutation`,
  `commitCompensationPlan`, `saveStaffEvaluation`, `compensationPlanWrites` and
  `setCompensationPlanStaff` all carry route literals. They are the standing tax of
  route-shaped cache invalidation; there is no indirection for them today, and adding
  one for five call sites would hide more than it saves.
- **Finance now sees two Dashboards children** (Compensation + Bonuses) rather than
  one, so `NavMenuItem` renders a real submenu for them instead of degrading to a plain
  link — see [ui.md](../ui.md) → *App shell & sidebar* → Submenus.
- **No schema, permission-matrix, gate or read-action change.** Every gate is the same
  check on the same capability as before; two of them are now spelled with an existing
  named constant instead of an inline literal.

## Alternatives considered

- **Keep the `/performance/*` URLs and only relabel the nav.** Rejected: the address
  bar and every `revalidatePath` would keep saying "performance" for sections called
  Dashboards and People management, which is exactly the mismatch this ADR exists to
  remove. Renaming the labels without the routes buys a smaller diff and leaves the
  confusion in the place hardest to notice.
- **Leave a summary bonus tile on the Compensation dashboard** linking across.
  Rejected: it keeps a `getBonusSummaryData` read on the comp page and reintroduces
  the reconciliation confusion in miniature — a "total bonuses paid" number beside
  active-staff averages invites exactly the arithmetic that doesn't work.
- **Put the bonus-payments entry screen under Dashboards, next to its dashboard.**
  Rejected: it writes money records about named individuals, which is the definition
  of the other section. The cross-link between the pair does the discovery work
  instead, in both directions.
- **Move Peer Feedback under People management.** Rejected — see above; it is the one
  ungated, everyone-facing surface in the domain.
- **Also rename `src/**/performance/` and `docs/domains/performance.md` to match.**
  Rejected as churn: the domain didn't change, only its presentation, and the rename
  would touch well over a hundred import paths to say nothing new.
