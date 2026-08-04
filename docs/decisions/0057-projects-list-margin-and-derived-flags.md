# 0057 — Projects list: derived risk flags with code-owned thresholds, and margin precomputed server-side in both display currencies

**Status:** accepted · 2026-07-30 · **§7 superseded by
[ADR 0061](./0061-projects-list-as-a-sortable-table.md)** (2026-08-02), which replaced the card
grid with a sortable table + status tabs and built the margin sort this ADR's alternatives list
left unbuilt. **§7's *principle* survives the layout change** — the badge column still carries
only derived warnings, status and LoB are still plain facts — but every mention of a *card*, a
`CardField` or a grid below is historical. §1–6 and §8 are untouched.

Extends [ADR 0053](./0053-project-budgets-and-margin.md) (budgets & margin) to a **third**
surface — the `/projects` list — and **deliberately deviates** from the client-side
conversion pattern of [ADR 0029](./0029-external-fx-rates-and-currency-normalization.md) §
*Alternatives* there. Tag machinery follows
[ADR 0034](./0034-company-status-derived-tags.md); thresholds-in-code follows
[ADR 0042](./0042-per-role-subratings-app-owned-jsonb.md) / `bill-rates.ts` /
`compensation-targets.ts`.

## Context

After ADR 0053, plan margin existed on exactly two surfaces — the project detail page and the
opportunity drawer's Project-plan tab — both **one project at a time**. `/projects` showed
name, company, a status badge, line-of-business badges, delivery managers (then read from the
`project_delivery_managers` junction; **derived from `DELIVERY` roles since
[ADR 0068](./0068-delivery-managers-as-project-roles-and-coverage-gaps.md)**) and a date range:
enough to *find* a project, nothing to tell you **which one needs attention**. The question a
delivery lead opens that page with is "what's in trouble?", and answering it meant opening
engagements one by one.

Two things had to be decided to answer it on a list: **what counts as trouble** (a threshold
question, not a data one), and **how a list of margins can be currency-toggled** without
either shipping compensation-derived per-role costs to the browser or refetching on every
toggle.

## Decision

### 1. Risk tags are derived, and their thresholds live in code

A new pure, client-importable module `src/lib/projects/project-flags.ts` — no `db`, no UI —
so the read that evaluates the flags (`getProjectsList`) and the card that renders the badges
share one definition of the tags, their canonical order and their labels. This is the exact
shape of `src/lib/crm/company-status.ts` (ADR 0034) and `project-derived.ts`: a `PROJECT_FLAGS`
tuple, a `Record<ProjectFlag, predicate>` table, label + badge-variant maps, and one
`projectFlags(input)` filter over the tuple.

Three tags, **worst first** so the most urgent one reads first in the badge row:

| Flag | Label | Rule |
|---|---|---|
| `negativeMargin` | Negative margin | margin **≤ `NEGATIVE_MARGIN_AT_OR_BELOW` (0)** |
| `lowMargin` | Low margin | `marginPercent < LOW_MARGIN_PERCENT (0.25)` **OR** `margin < LOW_MARGIN_AMOUNT (10_000)` |
| `endingSoon` | Ending soon | latest role end date within **`ENDING_SOON_DAYS` (14)** of today, and not already past |

- **The two low-margin floors are OR'd on purpose.** A large engagement at 15% and a small one
  at 40% that clears only $10k are both worth a second look, and either threshold alone misses
  one of them.
- **A loss suppresses "Low margin."** `margin ≤ 0` earns `negativeMargin` only — "we're paying
  to do this" and "this is tight" are different conversations, and showing both badges is
  noise. Zero counts as a loss: a plan that exactly breaks even earns nothing.
- **Cancelled projects get no flags at all** (`isLive`): neither the plan margin nor the end
  date of work nobody will deliver is a fact about anything anyone still has to do.
- **Unknown margin yields no margin flags.** No budget, no cost basis, or a viewer without
  `projects.viewMargin` ⇒ `margin: null` ⇒ silence. "We can't tell" is not "it's bad", and the
  *absence* of a tag must not become a side channel for the figure.

**Thresholds in code, not a table** (`PROJECT_FLAGS_REVIEWED_ON = "2026-07-30"`, bump it when
you edit one). "Thin margin" is **policy** the company revises periodically, and every project
must be judged by the same one or two projects could silently disagree about what "healthy"
means. A code constant makes a revision a code review instead of a migration, versioned
alongside the code that interprets it — the same argument as the bill-rate card (ADR 0053 §2;
`BILL_RATES` itself was later deleted when the card was re-keyed, see
[ADR 0066](./0066-rate-card-by-line-of-business-and-snapshotted-role-bill-rates.md) — the
*code-as-policy* precedent stands, only the identifier is gone) and `COMP_TARGETS`.

### 2. Flags are evaluated server-side, in ONE currency, and never recomputed on the client

`MARGIN_FLAG_CURRENCY = "CAD"` is the currency both money thresholds are denominated in, and
therefore the currency every margin flag is evaluated in — regardless of what the reader is
displaying.

The list's CAD/USD control is a **display** choice. If the amount floor were applied to the
displayed figure, a project would gain and lose "Low margin" as the reader toggled currency:
the tag would describe the *rendering* rather than the engagement. **The cost of getting this
right:** viewing in USD, a card can read "$7,400" and still carry "Low margin" because it is
CA$10,100 — under the CAD floor. That's the intended trade; don't "fix" it by moving the
predicate client-side.

### 3. The list precomputes margin server-side for **both** display currencies

`ProjectListItem.margin` is a `Record<DisplayCurrency, { margin, marginPercent }> | null`.
The list runs `computeProjectMargin` **twice per project** (there are only two display
currencies) and ships two whole-project figures per card; per-role detail is dropped.

**This deviates from the detail page**, which follows ADR 0029/0053 §8: ship native amounts +
the USD rate table and let the client convert. Two reasons the list inverts it, the second
load-bearing:

- **Payload.** Two numbers per card is far less than every role's hours, role type, dates and
  assignee for every project in five sections.
- **No individual's compensation-derived hourly cost is ever sent to the browser for the
  list.** The plan surfaces earn that exposure — they render a per-role table where the cost
  *is* the content, behind `projects.viewMargin`. A list has no per-role table to justify it,
  so the cost never crosses the wire; only an aggregate does.

`null` still means exactly "this viewer lacks `projects.viewMargin`" (ADR 0053 §7's one-signal
rule), because the whole record is absent when `getProjectCostBasis` returns null.

**The detail page's approach is unchanged.** Two surfaces, two conversion strategies, chosen by
what each has to put on the wire — don't unify them without re-reading both rationales.

### 4. A plan with no counted roles reports a **null** margin, not a number

`countedRoleCount === 0` ⇒ `margin` and `marginPercent` are both null even when a budget
exists. Its cost total is a true zero only because nobody is staffed, so an unstaffed fixed fee
would read as a triumphant 100% margin and an unstaffed T&M project as exactly 0 — which §1's
predicates would then call a **loss**. Neither is a fact about the engagement. The detail
page says the same thing in words ("nothing to cost against the budget").

### 5. The shared cost/FX inputs are request-scoped, via React `cache()`

`src/actions/projects/getProjectsMarginContext.ts` (server-only) returns
`{ rates, costBasis, nativeCurrencies }` wrapped in React `cache()`.

The grouped view fires **five** list reads in parallel (Tentative / Paused / Active / Past /
Cancelled) — *[ADR 0061](./0061-projects-list-as-a-sortable-table.md) replaced that with one row
read plus five bucket `count()`s; the sharing argument is unchanged]* — and
`getRoleTypeAverageCostsUsd` inside the cost basis scans all of
`staff_employment`. `cache()` memoizes the *promise*, so those five concurrent callers plus the
page itself (which needs `costBasis` to decide whether to render the toggle) share one fetch.
That request scope is also why the cost basis covers **every** staff member on any project role
rather than the current page's rows: a page-scoped id list would be a different cache key per
section and defeat the sharing, for one extra `where` on a query that runs either way.

**Cost still comes only from `getProjectCostBasis`**, so the `projects.viewMargin` decision
remains in exactly one place (ADR 0053 §7). `getProjectsList` adds **no queries** — the budget
columns joined the existing base selects, and `roleType`/`hoursPerDay`/`staffId`/`id` joined
the existing role query.

### 6. The list's FX note is **list-scoped**, not per-project provenance

`ProjectMargin.convertedFrom` records the currencies one project actually converted from, and a
budget panel states exactly that. The list instead ships `nativeCurrencies` — every currency a
rate could be applied to **anywhere in the list**, in canonical order — and `FxRateNote` renders
that once beside the toggle.

The list's control converts every card at once, so the caveat belongs to the list. The honest
alternative — threading a per-project, per-currency `convertedFrom` up through five
independently paginated sections — would put per-role provenance in the payload to qualify a
single footnote. **Accepted cost:** a filtered view showing one CAD project can still quote a
rate for a currency only some *other* project is priced in.

### 7. On the card, the badge row means "look at this one"; status and LoB become fields

`project-card.tsx` became a client component (it reads the currency context) and its badge row
now carries **only** the derived flags. The `ProjectStatusBadge` and the outline
line-of-business badges are **gone from the card** — both moved into its definition list as
plain text fields (Status · Line of business · Delivery · Dates · Margin).

Status and line of business are **facts**; the flags are **warnings**. When every card carries
three badges unconditionally, a badge distinguishes nothing — reserving the row for exceptions
is what makes a red "Negative margin" visible from across the grid. Two deliberate
inconsistencies that follow: the **project detail page still badges status**
(`ProjectStatusBadge` survives there and on the staff profile's Projects section — one project,
nothing to scan), and the **companies table's badges are still facts** (Partner / Client /
Prospect *is* its Status column, ADR 0034). This is a card-level convention, not an app-wide
one.

The `Margin` field renders **only when the server sent figures**, and the two reasons there's no
figure to lead with say so **in words** — "No budget" and "No roles" — rather than a bare em
dash: "nobody has priced this yet" and "nobody is staffed on it yet" are actionable, where a
dash reads as a number we lost. The money leads, the percentage supports it (ADR 0053 §5).

### 8. The display currency is client context defaulting to **CAD**, not a URL param

`src/components/projects/projects-currency.tsx` holds the list's `DisplayCurrency` in a React
context (`ProjectsCurrencyProvider` / `useProjectsCurrency`), with the `ToggleGroup` +
`FxRateNote` in the filter bar and cards reading it below.

- **Context, not a prop:** the toggle sits in the filter bar while the cards it governs are
  spread across five independently server-rendered sections.
- **Client state, not the URL:** currency is a *display* preference, so putting it alongside the
  real filters (`q`/`lob`/`dm`/page params) would both conflate the two and make flipping it a
  navigation. Both currencies are already in the payload (§3), so switching is instant and
  refetches nothing.
- **Default CAD**, unlike the detail page's per-project `resolveDisplayCurrency` (a fixed fee's
  own denomination, else the rate card's, else USD). A list is for **comparing**, and cards in
  five different denominations can't be compared; one currency for the whole list also means one
  conversion note.
- **The toggle renders only when a cost basis came back** — cosmetic only: a viewer without
  `projects.viewMargin` has nothing to convert because the *read* withheld the figures, not
  because the control is hidden.

## Consequences

- **Which flags a viewer sees depends on their capability.** Without `projects.viewMargin`,
  margin is null, so only **Ending soon** can ever appear. That's the intended fail-quiet
  behaviour (§1), but it means two people can legitimately see different badge rows on the same
  project — don't read a bare card as "this project is fine".
  > **Amended by [ADR 0059](./0059-project-delivery-notes-and-list-health.md):** the tuple now has
  > a fourth tag, **`lowHealth`** (second, after `negativeMargin`), and it is **ungated** — a
  > non-`viewMargin` viewer sees *two* tags, Ending soon **and** Low health. Health is a human
  > delivery judgement, not compensation-derived, which is the only thing §1's fail-quiet rule was
  > protecting. The rest of this ADR is unchanged, and the "unknown ⇒ no tag" rule extends to
  > unrated projects.
  >
  > **Amended again by [ADR 0068](./0068-delivery-managers-as-project-roles-and-coverage-gaps.md):**
  > a **fifth** tag, **`noDeliveryManager`** (third — below `lowHealth`, above `lowMargin`),
  > also **ungated** for the same reason, so a non-`viewMargin` viewer can now see *three*.
  > It fires only on coverage gaps ending **today or later**, so the Past tab doesn't carry
  > permanent badges; it takes **pre-derived** gaps on `ProjectFlagInputs` so this module keeps
  > owning no date arithmetic; and it added **no threshold constant**, so
  > `PROJECT_FLAGS_REVIEWED_ON` did *not* move.
- **One residual em dash.** The card's "No roles" branch tests `roleCount` (**all** roles,
  including cancelled) while the null margin comes from `countedRoleCount` (which excludes
  cancelled). So a budgeted project whose roles are *all cancelled* has `roleCount > 0` and a
  null figure, and renders "—". It sits in the Cancelled section, carries no flags, and is the
  only path left to a bare dash.
- **`roleBillableHours`' working-day count runs twice per role** (once per display currency).
  That's the first thing to look at if the unpaginated Active section ever gets long; caching
  hours per role would break the currency symmetry for no gain at today's scale.
- **`getProjectsMarginContext` adds a handful of request-scoped queries** to `/projects` — two
  `selectDistinct`s plus, for `viewMargin` holders, the cost basis's employment reads and the
  12h-cached FX `fetch`. Once per request, not once per section.
- **`src/lib/projects/project-flags.test.ts` (22 tests)** is another sanctioned exception to
  [ADR 0037](./0037-unit-tests-removed-except-rbac-matrix.md), on ADR 0053's margin-math grounds:
  threshold boundaries, the OR of two floors, the loss-suppresses-low rule and the
  cancelled/unknown silences are exactly the cases the type system can't express.
- **No schema change, no migration, no seed change.** Flags and list margin are entirely derived.
- **Revising a threshold re-tags every project retroactively** and silently, since flags are
  always evaluated from the current constants — at the time, the same "no history" property as
  `BILL_RATES` (ADR 0053). *(That parallel has since broken:
  [ADR 0066](./0066-rate-card-by-line-of-business-and-snapshotted-role-bill-rates.md) snapshots a
  rate onto each role, so a **card** revision now prices only future roles, while a **threshold**
  revision is still fully retroactive. Flags are the last code-as-policy constant with the property.
  Separately, note the flags' *inputs* moved under them — a project can flip in or out of "Low
  margin" purely from an off-card rate, with no threshold change.)*
  `PROJECT_FLAGS_REVIEWED_ON` is the only signal of when the policy last moved.

## Alternatives considered

- **A stored `flags` column / a thresholds table.** Rejected for ADR 0034's reason: the inputs
  (margin, end date, status) are all live-derived, so a stored tag can only drift; and a
  thresholds *table* would let the policy be edited without review while gaining nothing.
- **Evaluating flags on the client** off the two shipped figures. Rejected — §2: the tag would
  follow the display currency, and a viewer without `viewMargin` would need the margin shipped
  to decide anything at all.
- **Shipping native amounts + rates and converting on the client** (the detail page's
  contract). Rejected — §3: it puts per-role compensation-derived cost in a list payload that
  has no per-role table to justify it.
- **A URL-backed `currency` param.** Rejected — §8: it's a display preference, not a filter, and
  toggling shouldn't be a navigation when both figures are already loaded.
- **Per-project FX provenance on the list.** Rejected — §6: per-role provenance in the payload to
  qualify one footnote.
- ~~**A margin *column* / sortable margin.** Not built. The grid is a card layout, and sorting by a
  figure half the roles can't be costed from would need a story for the nulls first.~~ — **built by
  [ADR 0061](./0061-projects-list-as-a-sortable-table.md)**, which answered the nulls question
  (**nulls last in both directions**) and gated the *ordering* on `projects.viewMargin` just like
  the figures.
