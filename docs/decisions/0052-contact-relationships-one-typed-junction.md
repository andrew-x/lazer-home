# 0052 — Contact ↔ contact relationships: one typed junction, cardinality in partial unique indexes

**Status:** accepted · 2026-07-29 · **supersedes [ADR 0022](./0022-contact-manager-self-reference.md)**

Sibling of [ADR 0048](./0048-company-contact-relationships-beyond-employment.md): that one
models *company* ↔ contact links beyond employment, this one models *contact* ↔ contact
links beyond management.

## Context

[ADR 0022](./0022-contact-manager-self-reference.md) gave `contacts` a single-purpose
self-FK, **`managerId`** — one optional pointer at a colleague, same-company enforced
app-side. It answered exactly one question and nothing else. Two more arrived:

1. **The job mover.** A contact changes employer. The old row is not garbage — it carries
   the opportunities they sourced, their notes, and the company they used to work at. So
   the move is *two contact rows for one human*, and the CRM had no way to say they are
   the same person, nor to stop the old row cluttering the roster and every picker.
2. **Any other tie.** "Worked together at Acme", "introduced us", "board peer" — a
   person-to-person link with no fixed vocabulary.

Plus a third, smaller gap: **direct reports were never readable.** `managerId` made the
reverse direction *possible* (`where managerId = X`) but nothing read it, and any read
would have been a second query with a second shape.

Three shapes were available:

1. **Keep `managerId` and add a second mechanism** for the other two kinds. Rejected —
   see below.
2. **A junction per kind** (`contact_reports`, `contact_successions`, `contact_relations`).
   Rejected: three tables with identical columns (a pair + optional text + two cascading
   FKs), three action trios, three revalidate helpers, three read queries, and a UI that
   has to decide which of three "add" buttons a user wants.
3. **One typed junction.** Chosen.

## Decision

Add **`contact_relationships`** (`src/lib/db/crm-schema.ts`), typed by a new
`contact_relationship_kind` pgEnum, and **drop `contacts.managerId`**. Migrations
`drizzle/0014_nasty_krista_starr.sql` (enum + table + indexes + `contacts.is_active`) and
`drizzle/0015_rainy_wrecking_crew.sql` (backfill, then `DROP COLUMN manager_id`).

| `kind` | Direction | Cardinality | `description` |
|---|---|---|---|
| `reports_to` | `contactId` reports to `relatedContactId`, **same company** | ≤1 per contact; reverse = direct reports | NULL |
| `succeeds` | `contactId` (NEW record, new employer) succeeds `relatedContactId` (OLD record) | ≤1 predecessor *and* ≤1 successor ⇒ a linked list | NULL |
| `related` | **symmetric** — stored once, read from either side | ≤1 per unordered pair | **required** |

### One typed junction, not a second mechanism beside `managerId`

Keeping `managerId` would have meant two write paths, two read shapes, two revalidate
helpers, and — the part that actually hurts — **two places in the UI where a
person-to-person link lives**: a read-only "Manager" `MetaField` set from the contact
*form*, plus a relationships list set from the contact *page*. The user would have to
learn which link lives where and why one of them can't be added after creation.

With one table, all three kinds share the pair-plus-optional-text shape, the cascade
semantics, `revalidateContactRelationship`, one create/update/delete trio, one dialog
(`contact-relationship-dialog.tsx`, a `kind` selector picking the picker's scoping — the
same move `RelationshipDialog` makes with its `side` prop), and one sidebar section. The
collapse also gets cheaper the earlier it happens: it cost a 15-row `INSERT … SELECT` now.

### `kind` is a pgEnum, even though this schema's other labels are free text

[ADR 0048](./0048-company-contact-relationships-beyond-employment.md) argued the *opposite*
for `company_contact_relationships.description`, and both are right, because the test is
**does the code branch on it**:

- `description`, `role`, `location` are **open** label sets that nothing branches on. A new
  value must not need a migration.
- `kind` is branched on in five places: which partial unique index applies, which cross-row
  validation runs, which read bucket it lands in, whether it has a side effect
  (`succeeds` deactivates the predecessor), and which sidebar caption it renders under. A
  fourth kind is **already** a code change — the migration is not its cost.

This is exactly [ADR 0016](./0016-junction-table-and-shared-enum-conventions.md)'s
tuple→pgEnum convention for closed sets. The tuple lives in the pure, client-importable
`src/lib/crm/contact-relationship.ts`, so the pgEnum, the zod discriminated union, the
group/kind labels, the hints, and the seed all derive from one source.

### Cardinality lives in four **named partial** unique indexes, not app checks

```
contact_relationships_one_manager_uq      (contact_id)          WHERE kind = 'reports_to'
contact_relationships_one_predecessor_uq  (contact_id)          WHERE kind = 'succeeds'
contact_relationships_one_successor_uq    (related_contact_id)  WHERE kind = 'succeeds'
contact_relationships_related_uq          (least(a,b), greatest(a,b)) WHERE kind = 'related'
```

- **Partial, because a table-level `unique()` can't carry a `WHERE`.** "One manager" is a
  constraint on the `reports_to` subset only.
- **Not app checks**, because an app check is a *read*: two concurrent requests can both
  pass it and both insert. The checks in `contactRelationshipChecks.ts` deliberately do
  **not** re-verify cardinality — the index owns it, so it holds under concurrency.
- **Named explicitly**, because Postgres reports the *index* name in a 23505's constraint
  field exactly as it does for a table `unique()`. That is what lets
  `mapContactRelationshipConflict` give each rule its own precise wording ("already has a
  manager" vs. "already succeeded by someone else") instead of one generic duplicate
  message.
- **No `unique(contactId, relatedContactId, kind)`.** It would be redundant — an exact
  `reports_to` repeat trips the manager index, a reversed `related` trips the symmetric one
  — and would only muddy which name a violation reports.

**Gotcha:** the enum literals in each `where` are **inlined** (`sql\`... = 'reports_to'\``),
not interpolated. drizzle-kit serialises an index's `where` through `sqlToQuery`, so a
bound value becomes a `$1` placeholder and emits broken DDL.

### `related` is canonicalised **in the index**, not in the writer

`related` is symmetric, so (A,B) and (B,A) are the same link. The unique is keyed on
`(least(a,b), greatest(a,b))` rather than having the write action sort the pair first:
an invariant in the writer can be forgotten by the next writer and can still race, while
the index cannot. `least`/`greatest` over `text` reduce to the type's btree comparator, so
they're immutable and index-legal. Storing both directions as two rows was rejected —
double the rows to keep in sync, and every read would have to dedupe.

Reads follow from that: `getContactDetail` runs **one** query with
`contact_id = $1 OR related_contact_id = $1` (served as a BitmapOr over the two plain
single-column indexes) and partitions the result in TypeScript by `kind` + which end the
viewed contact is on.

### `description` belongs to `related` and only to `related`

Enforced twice, deliberately: the **zod discriminated union** owns the user-facing message
(and parses the directional kinds' `description` to a hard `null`, so the writer can pass
the field unconditionally), and the CHECK `contact_relationships_description_kind`
(`(kind = 'related') = (description is not null)`) owns the invariant. A second CHECK,
`contact_relationships_no_self`, forbids self-links.

### Cross-row rules stay in the app — with a bounded walk, not `WITH RECURSIVE`

`assertValidContactRelationship` (run inside the insert's transaction) enforces what no
constraint can express because it reads *another* row:

- **`reports_to` — same company.** ADR 0022's rule, preserved verbatim; a NULL company on
  either side is a rejection ("Set a company before choosing a manager").
- **`succeeds` — *different* company.** Two records at the same company aren't a
  succession, they're a duplicate contact. NULL here is **permissive**, not blocking:
  "employer unknown" is not evidence of sameness. (This is the same NULL trap ADR 0048
  flagged in `searchContacts` — never compare nullable columns bare.)
- **No cycles**, for both directional kinds, via one bounded walk over that kind's outgoing
  edges (`MAX_CHAIN_DEPTH = 32`). Each hop is a single index lookup on that kind's partial
  unique and real chains are 1–3 deep, so a loop beats a `WITH RECURSIVE` (which this repo
  has no precedent for). **Exhausting the cap counts as "reachable"** — the only way to get
  that deep is data that already loops, and pre-existing loops *do* exist because ADR 0022
  never guarded cycles.

`assertValidManager` is deleted from `contactChecks.ts` (`mapContactEmailConflict` stays).

### `contacts.isActive` is a real column, not `EXISTS(successor)`

New `boolean notNull default true`, mirroring `staff.isActive`. Creating a `succeeds` link
marks the **predecessor** inactive in the same transaction, so there is no state where the
chain exists but the old record still shows up in the default list and every picker.

It is **not** derived from the link, because "we no longer deal with this person" is an
independent fact:

- People leave without anyone creating a forwarding record. Derivation would make that
  case unrepresentable.
- A derived flag can't be corrected. The default contacts list and five pickers filter on
  it, so it has to be a plain indexed-able column, not a subquery.

**Removing a `succeeds` link therefore does *not* reactivate the predecessor.** There is no
inverse to apply: if the link was a mistake, the old record is probably still one we don't
work from, and silently reviving someone would surprise. The way back is explicit — a
**Status** switch ("Active" / "Inactive") **in the Edit contact dialog**, carried as a required
`isActive` on `updateContactSchema` and written by `updateContact`. That switch is what keeps
"Inactive" from being a one-way trap, and the remove-confirm copy deliberately says the record
*stays* inactive rather than promising otherwise.

**Where that switch lives changed after this ADR was first written; the decision above did
not.** It shipped as an inline sidebar control (`inline-active-field.tsx`, an `isActive`
variant on `updateContactField`, write-on-toggle like the star rating) and **moved into the
dialog** — the component and the union variant are both deleted, and
`updateContactField.schema.ts` now carries a comment saying why there's no `isActive`
variant. Reason: status is an **occasional, deliberate decision about a person**, not a quick
in-place tweak like owner / location / rating, and it belongs beside the **employer** it
usually changes with. The dialog's helper line goes conditional to cover the automatic case —
`INACTIVE_BY_SUCCESSION_EXPLANATION` when the contact has a successor, else the fuller
`INACTIVE_EXPLANATION` (both from `src/lib/crm/contact-status.ts`; see the vocabulary
amendment under Consequences). (Without that, flipping the switch back on looks like the
obvious fix for a record that only *looks* wrong.) `AddContactDialog` has no Status field at
all: a new contact is always active.

One more write touches the junction from outside the relationship actions: **`updateContact`
deletes the contact's `reports_to` row when `companyId` changes**, in the same transaction,
because a cross-company manager is invalid by the rule above. (ADR 0022 got the same effect
by having the picker silently reset; the edit dialog now warns before you save.)
`updateContact`'s fixed column list **includes `isActive`**, exactly like `ownerId` — the
Status switch is one of its fields, so a full-record save must round-trip it. The accepted
cost: `createContactRelationship` is the *other* writer of the flag (it marks the predecessor
inactive), so a **stale dialog** opened before a succession and submitted after it would set
the predecessor back to active. That's the ordinary last-write-wins of any full-record dialog, so
it's documented in `updateContact`'s docstring rather than special-cased with a
read-modify-write or an optimistic-concurrency token — neither of which exists anywhere else
in this codebase, and the window is a single user's own open dialog.

### Succession is read **one hop** only

`getContactDetail` returns `predecessor` and `successor`, not the whole chain. The rail
shows five captioned groups from the viewed contact's point of view — *Reports to · Direct
reports · Previously · Moved to · Also connected* — and each neighbour is one click away.
A full chain read would mean a recursive query for a case (two or more recorded job moves)
that hasn't happened yet.

The **contacts list** reads the same one hop, in its own way: `getContactsPage` exports
`ContactRowSuccessor` (`{ id, name, companyName }`) and `ContactRow.successor`, filled by a
module-private `successorsByPredecessor(ids)` — **one grouped query for the whole page keyed by
the predecessor's id**, deliberately shaped like `openTasksByParent` rather than joined onto the
row query. Joining would force a second relationship join onto *both* halves of the paginated
`count()`/rows pair; the grouped query stays out of that and hands back exactly the map the row
assembly wants. A **flat** map (not a map of arrays) is correct because
`contact_relationships_one_successor_uq` already guarantees at most one successor per
predecessor.

### Accepted limitation: you can't add "X reports to me" from a manager's page

The viewed contact is **always** written as `contactId`, so `reports_to` means "this person
reports to the one you pick" and `succeeds` means "this record continues the one you pick".
That asymmetry is load-bearing, not laziness: because the owning side is always the page
you're on, "at most one manager" and "at most one predecessor" can be enforced by
**omitting the kind option** (with a muted hint saying why) instead of surfacing a server
rejection after the fact. It also means the two reverse groups — Direct reports, Moved to —
are **read-only**: their authoritative row belongs to the other contact, and removing it
from here would silently rewrite someone else's record.

## Consequences

- **Amendment — the user-facing vocabulary is "Active / Inactive", never "current / former".**
  The decision above is unchanged; only the words and the explanation shown to users are.
  Renaming happened because **"former" describes only one of the two situations the flag
  covers**: the person no longer works at the company on the record. It equally covers a
  record that's no longer relevant or valid at all — a duplicate, a bad record, someone we
  simply no longer deal with — and **the row doesn't store which reason applies**, so any
  label that asserts one is wrong half the time. "Inactive" covers both without asserting a
  reason.
  - A new pure, client-importable module **`src/lib/crm/contact-status.ts`** (sibling of
    `relationship-strength.ts`) owns the words: `ACTIVE_LABEL` / `INACTIVE_LABEL`,
    `contactStatusLabel(isActive)`, plus `INACTIVE_EXPLANATION` (the long form naming *both*
    cases, for the edit dialog) and `INACTIVE_BY_SUCCESSION_EXPLANATION` (the narrower line
    for a record a `succeeds` link deactivated — there the reason *is* known).
  - **All four badge sites import `INACTIVE_LABEL`** rather than hardcoding it
    (`contacts-table.tsx`, `contact-detail-view.tsx`, `company-detail-view.tsx`,
    `related-contacts-section.tsx`) — that shared constant is the drift guard, and the reason
    a future rename is one edit rather than five.
  - The list filter is **"Include inactive"** and its **URL param is `inactive=1`** (was
    `former=1`); `ContactListFilters.includeFormer` became **`includeInactive`**, matching
    `searchContacts`' arg of the same name — the two were inconsistent before.
  - **Deliberately not renamed:** the free-text relationship *descriptions* "Former employee"
    (`company-contact-relationship.ts`) and "Former colleague" (`contact-relationship.ts`),
    and the prose about a company ↔ contact link describing a former employee/employer. Those
    describe a relationship, not this flag. The only "former" left in the code is the four
    places explaining why the flag's word isn't that — keep that reasoning intact.
- **`searchContacts` changed behaviour for every caller**, not just the new dialog. It
  gained `excludeId`, `withCompany`, and **`includeInactive` defaulting to `false`** — so
  the four pre-existing pickers (`contacts-combobox-field`, the opportunity contacts +
  source fields, the company page's relationship dialog) now **exclude inactive contacts**.
  Only the `succeeds` predecessor picker opts back in, and it also sets `withCompany`,
  because every candidate there shares *the same person's name* and only the employer tells
  them apart (ids are what's submitted, so the suffix never reaches storage).
- **`getContactDetail` lost `managerId`/`managerName`** (and the `managers` alias) and gained
  `isActive` plus five buckets of the new exported `ContactRelation` type. Its name is
  composed in TS via `contactName`, **not** `contactNameSql`: a raw SQL expression isn't
  attributable to a table, so the left join to the other person's company would widen it to
  nullable.
- **The contacts list hides inactive contacts by default.**
  `ContactListFilters.includeInactive` (URL `inactive=1`, like `nearby=1`) feeds both the
  `count()` and the rows. It is the only
  contacts filter that **widens** the result set, which is why the table's `filtered` prop
  deliberately ignores it (it can never cause an empty result) while the bar's "Clear
  filters" affordance does count it. When an inactive row *does* appear it isn't a dead end: the
  name cell carries a third muted line, **"Moved to \<newer contact\> at \<their company\>"**,
  because where the person went is the one thing worth knowing without opening the page.
- **A company's page still lists its inactive people**, badged rather than filtered — a
  `succeeds` predecessor's employer *is* the old company, so hiding them would hide the
  history the link exists to record. Both of its contact tables render that badge (the
  employee directory in `company-detail-view.tsx` and `related-contacts-section.tsx`), which
  is the **opposite** posture from the contacts list: badge-not-hide there, hide-by-default
  here.
- **The contact form has no relationship field at all.** `managerId` is gone from
  `contactFields`, and `manager-combobox-field.tsx` is deleted. Relationships are added from
  the contact's own page, once it exists.
- **The *edit* contact form gained a Status field** (and only the edit one). So
  `updateContactSchema` and `createContact.schema.ts`'s shared `contactFields` now differ by
  more than `id`/`ownerId`: `isActive` is on the update schema alone, on purpose. The contact
  detail sidebar correspondingly has **no** Status entry, and
  `updateContactField`'s union is `owner | location | relationshipStrength` only.
- **The 320px rail needed a new primitive**, not `DetailSection` + `DetailTable` (whose
  columns don't fit): `SidebarGroup` in `detail-parts.tsx` — shared, so it is no longer
  contact-only. Direct reports preview 5 behind a `Collapsible`.
- **An inactive record with a successor answers "where did they go" in its identity
  subtitle** ("Moved to X at Y"), because that page is a dead end someone reached by
  accident. The reverse case (an active record with a predecessor) gets nothing extra. The
  badge and the subtitle are independent: an inactive contact deactivated by hand has no
  successor and gets the badge alone.
- **The contact sidebar was re-ordered around the new group**, ending up as: identity →
  one section of *Email · Phone · LinkedIn · Company · Location* → Relationships →
  Relationship strength → Owner. Two consequences of dropping the read-only "Manager"
  `MetaField` there: `InlineLocationField` gave up its own divided section and joined the
  contact-method block (it's another "where to find them" fact, and it reads as one block
  with Company above it — `SidebarSection` already styles `MetaField` and
  `InlineEditField` labels identically, so the mix needs no styling fork), and the star
  rating's visible label widened from "Relationship" to **"Relationship strength"** so it
  can't be misread as a shorthand for the Relationships group now sitting above it (the
  aria-label already said that; the component, action variant and column names are
  unchanged).
- **The seed had to become invariant-aware** (`scripts/seed/crm.ts`) — the four partial
  uniques abort a seed rather than silently deduping. `reports_to` now points only at a
  strictly *earlier* colleague (structurally acyclic); `succeeds` makes 5 pairs where the
  newer record takes over the older one's name and marks the older inactive; `related` dedupes
  on the *unordered* pair. The old `managerId` pass claimed to avoid cycles but only guarded
  self-management, so 2-cycles were reachable — and one existed in the seeded data.

## Migration notes

`0015` is **hand-edited** (like the data steps in `0002` and `0010`): drizzle-kit emits DDL
only, and the `INSERT … SELECT` must run *before* the `DROP COLUMN` or the data is gone.
Two decisions in it worth keeping:

- **Ids are minted in SQL** (`'crel-' || replace(gen_random_uuid()::text,'-','')`), so
  backfilled rows read `crel-<uuid hex>` rather than `crel-<cuid2>`. Same prefix convention,
  opaque either way; the alternative was an out-of-band script step on a continuously
  migrated DB.
- **Cross-company and cyclic manager links are carried across as-is.** Same-company was
  always an app-level rule (ADR 0022), never a DB constraint, and `updateContact` never
  revalidated a manager's reports when the *manager's* own company changed — so stale pairs
  were possible. Dropping them would lose data; the new reads are one hop deep and the cycle
  check only blocks *new* writes.

## Alternatives considered

- **Keep `managerId`, add one junction for the other two kinds.** Rejected — two mechanisms,
  two UI homes for the same concept (see above).
- **A junction per kind.** Rejected — three identical tables, three action trios, three read
  paths.
- **Cardinality enforced in the action bodies.** Rejected: reads race, and the DB already
  expresses it exactly.
- **Canonicalising `related` in the writer, or storing both directions.** Rejected — the
  first is forgettable and racy, the second doubles the rows.
- **`isActive` derived from the presence of a successor.** Rejected: it would make "left,
  no forwarding record" unrepresentable and the flag uncorrectable.
- **Status as an inline write-on-toggle sidebar switch** (how it originally shipped).
  Rejected on second look: the sidebar's in-place controls are for cheap, frequently-adjusted
  attributes (owner, location, rating), and a one-click toggle that removes a person from the
  default list and every picker is neither. It also sat four sections away from the employer
  it usually changes with. Cost of moving it: a full-record save now round-trips `isActive`
  (see above).
- **Joining the successor onto the contacts-list row query.** Rejected: the join would have to
  be duplicated onto the `count()` as well, for a value only inactive rows use.
- **A recursive read of the succession chain.** Deferred — one hop covers today's data, and
  each neighbour is one click away.
- **A `pgEnum` for the `related` description too.** Rejected for the same reason ADR 0048
  rejected it: an open label set (`CONTACT_RELATION_SUGGESTIONS` is autocomplete only, and
  nothing validates against it).
