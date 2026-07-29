# Unified contact ↔ contact relationships

## Context

`contacts` can only express one person-to-person link today: `contacts.managerId`, a
single-purpose self-FK ([ADR 0022](../decisions/0022-contact-manager-self-reference.md)).
Everything else about how two people relate is unrepresentable.

The concrete need: **people change jobs.** When a contact leaves Acme for Globex we create a
new record at the new company (they have a new work email, a new role, a new employer), and
today the old record's history — its notes, tasks, opportunities, relationship strength —
becomes an orphan nobody will find again. There is no link between the two records, no signal
that the old one is stale, and no way to answer "where did they go?" from the dead-end page.
"Former employee" exists only as free text in a `company_contact_relationships.description`
— a label, not a state: nothing queries it and nothing derives from it.

The outcome: **one** `contact_relationships` table that carries every person-to-person link,
typed by `kind` — including the manager relationship, which moves off its column and into the
junction so "how contacts connect" has exactly one home. Plus `contacts.isActive`, so a
superseded record is visibly Former and drops out of the default list and the pickers.

This directly mirrors last commit's `company_contact_relationships`
([ADR 0048](../decisions/0048-company-contact-relationships-beyond-employment.md)) — same
data-carrying-junction shape, same action trio, same violation-to-message translation.

### Decisions already made with the user

| | |
|---|---|
| **Model** | One table, typed `kind`, **`contacts.managerId` dropped** — not a second mechanism alongside it. |
| **Old record** | Gets a real `isActive` state (mirroring `staff.isActive`), not a derived or absent one. |
| **History** | **Link only.** Notes/tasks/activity stay where they were written; the new record links to the predecessor. No copying, no recursive activity read. |
| **Where relationships are edited** | A **Relationships section in the contact detail sidebar** (the "meta side") is the *one* place all kinds are added and removed. The Manager picker leaves the Add/Edit Contact dialogs entirely. |

---

## The model

```
contact_relationships
  id, kind, contactId → contacts.id, relatedContactId → contacts.id,
  description (nullable), createdAt, updatedAt      -- both FKs cascade
```

Read every row from `contactId`'s point of view:

| kind | direction | meaning | cardinality |
|---|---|---|---|
| `reports_to` | directional | `contactId` reports to `relatedContactId`; **same company** (the pre-existing rule) | ≤1 manager per contact; reverse = **direct reports**, a capability `managerId` never had |
| `succeeds` | directional | `contactId` (NEW record, new employer) succeeds `relatedContactId` (OLD record) — the same human, two rows | ≤1 predecessor per contact **and** ≤1 successor per predecessor (it's a chain) |
| `related` | **symmetric** | free-text `description` ("Worked together at Acme"); stored once, read from either side | one link per unordered pair |

`description` is **required for `related` and NULL for the other two** — enforced by a zod
discriminated union (owns the message) and a CHECK (owns the invariant).

### Why a pgEnum for `kind`

The repo's convention for a closed set is unambiguous — every one is a pgEnum whose value
tuple lives in a pure client-importable module (`opportunityStatusEnum`, `roleEnum`,
`timesheetStatusEnum`, …); the text-column exceptions are all *open* sets that say so in a
comment (`contacts.role`, `location`, `companyContactRelationships.description`). `kind` is
firmly on the closed side: the code branches on it for cardinality, validation, the read
buckets, and a side effect. A pgEnum also types `kind` as the union in `db.select()` results,
making the TypeScript partition exhaustive-checkable. Precedent inside CRM:
`opportunities-schema.ts` already holds two.

### Why partial unique indexes for cardinality

Postgres table constraints can't be partial, so these are **named `uniqueIndex(...).where(...)`**
— verified supported in `drizzle-orm@0.45` (`pg-core/indexes.d.ts:67`) and emitted with the
`WHERE` by `drizzle-kit@0.31`. Postgres reports the *index* name in a 23505's constraint
field, so `isUniqueViolation(error, name)` keys off them exactly as it does off a `unique()`
today (precedent: `uniqueIndex("compensation_plan_item_plan_staff_uq")`,
`performance-schema.ts:246`).

```
contact_relationships_one_manager_uq       (contactId)         where kind='reports_to'
contact_relationships_one_predecessor_uq   (contactId)         where kind='succeeds'
contact_relationships_one_successor_uq     (relatedContactId)  where kind='succeeds'
contact_relationships_related_uq           (least(a,b), greatest(a,b)) where kind='related'
```

Plus two plain read-path indexes on `contactId` and `relatedContactId` (the detail read is one
`OR` across both columns → BitmapOr; the partial uniques cover only subsets so neither serves
as a general index). Two CHECKs: `contact_relationships_no_self` and
`contact_relationships_description_kind`.

Deliberately **no** `unique(contactId, relatedContactId, kind)` — fully redundant with the
four partial uniques, and it would muddy which constraint name a violation reports.

> **Verify at implementation time:** the `least`/`greatest` index expression must be accepted
> as immutable by Postgres. If `CREATE INDEX` rejects it, fall back to canonicalising the id
> order in `createContactRelationship` before insert plus a plain
> `unique(contactId, relatedContactId)` scoped by a `related`-only partial index. Do **not**
> ship symmetric dedupe as an app-only two-read check — it races.

**`sql` template trap:** drizzle-kit serialises an index's `where` through `sqlToQuery`, so any
*interpolated value* becomes a `$1` placeholder and produces broken DDL. Write enum literals
inline — `` sql`${t.kind} = 'reports_to'` `` — never `` sql`${t.kind} = ${SOME_CONST}` ``
(use `sql.raw()` if a constant is ever needed, as the `performance-schema.ts:135` CHECK does).

---

## Files

### New

| Path | What |
|---|---|
| `src/lib/crm/contact-relationship.ts` | Pure, client-importable: the `kind` tuple, group labels, `RELATED_DESCRIPTION_SUGGESTIONS`, and the direction-sentence helpers so row / tooltip / confirm copy can't drift. Sibling of `company-contact-relationship.ts`. |
| `src/actions/crm/contactRelationship.schema.ts` | `z.discriminatedUnion("kind", …)` create schema + description-only update + delete. One schema file for all three verbs, mirroring `companyContactRelationship.schema.ts`. |
| `src/actions/crm/contactRelationshipChecks.ts` | `server-only`. The cross-row rules: same-company, different-company, cycle walk, plus `mapContactRelationshipConflict`. A separate file, not an extension of `contactChecks.ts` — that one is about invariants of a *`contacts` row*, this is a different table shared by three actions. |
| `src/actions/crm/createContactRelationship.ts`<br>`updateContactRelationship.ts`<br>`deleteContactRelationship.ts` | One action per file, all `permission: { crm: ["edit"] }`. |
| `src/components/crm/contact-relationships-section.tsx` | `"use client"`. The sidebar section: five kind-groups, Add affordance, remove `ConfirmDialog`. |
| `src/components/crm/contact-relationship-dialog.tsx` | `"use client"`. One dialog, all three kinds; edit for `related` only. |

### Modified

`src/lib/db/crm-schema.ts` · `src/actions/crm/{getContactDetail,getContactsPage,getCompanyDetail,searchContacts,updateContactField,createContact,updateContact,contactChecks,revalidate}.ts` ·
`src/actions/crm/{createContact,updateContactField}.schema.ts` ·
`src/components/crm/{contact-detail-view,add-contact-dialog,edit-contact-dialog,contact-fields,contacts-table,contacts-list-filters,detail-parts}.tsx` ·
`src/app/(app)/contacts/page.tsx` · `scripts/seed/{crm,wipe}.ts` · `scripts/seed.ts`

### Deleted

`src/components/crm/manager-combobox-field.tsx` — its whole value-add is the flat
`value: string | null` + `selectedName` adapter that lets an id-only form drive an
`EntityOption` combobox; the new dialog stores a full `EntityOption` in form state (as
`relationship-dialog.tsx` does), so the adapter is dead weight. It also hardcodes the label
and a `{ companyId }`-only `searchArgs`, while the new picker needs `excludeId`,
`includeInactive`, `withCompany`, a per-kind label and an `invalid` flag — at which point it
*is* `EntityCombobox`. Only the two contact dialogs import it, so the delete is clean.

### Recommended cheap rename

`relationship-dialog.tsx` → `company-contact-relationship-dialog.tsx` (two import sites).
Otherwise the folder holds `relationship-dialog.tsx` next to `contact-relationship-dialog.tsx`,
a permanent coin-flip for every future reader.

---

## Migration (the risky step — do it deliberately)

1. Edit the schema, then `bun run db:generate`.
2. **Hand-insert the `manager_id` backfill immediately before the `DROP COLUMN`.** drizzle-kit
   emits DDL only. Its statement order is
   `createTables → addColumns → references → indexes → dropColumns`, so `DROP COLUMN` lands
   last — but **read the generated file and confirm it** rather than trusting that.
   Precedent for hand-editing a generated migration: `drizzle/0008_eminent_mandroid.sql`
   (`DELETE`s wedged before three `DROP COLUMN`s) and `drizzle/0002_gray_corsair.sql`. Use
   `0008`'s plain `--` comment style, not `-->` (that collides with the
   `--> statement-breakpoint` sentinel).

   ```sql
   INSERT INTO "contact_relationships" ("id","kind","contact_id","related_contact_id","description","created_at","updated_at")
   SELECT 'crel-' || replace(gen_random_uuid()::text,'-',''), 'reports_to',
          "contacts"."id", "contacts"."manager_id", NULL, now(), now()
   FROM "contacts"
   WHERE "contacts"."manager_id" IS NOT NULL
     AND "contacts"."manager_id" <> "contacts"."id";
   ```
   Ids are minted in SQL (`crel-<uuid hex>` rather than `crel-<cuid2>`) — same prefix, opaque
   either way; the alternative is an out-of-band script step on a DB the team keeps
   continuously migrated. `is_active` needs no backfill: `ADD COLUMN … DEFAULT true NOT NULL`
   is metadata-only since PG 11.

3. **Pre-flight against Neon before `db:migrate`** — the backfill carries existing data
   *as-is*, and some of it may already violate the app-level rules (`assertValidManager`
   validates at write time only, and `updateContact` never revalidates a manager's reports
   when *their* company changes — ADR 0022 flags this):

   ```sql
   -- cross-company manager links (violate the app rule; migrated as-is)
   SELECT c.id, c.company_id, m.company_id FROM contacts c JOIN contacts m ON m.id = c.manager_id
   WHERE c.company_id IS DISTINCT FROM m.company_id;
   -- 2-cycles (reachable in seeded data: scripts/seed/crm.ts:82-89 only guards self)
   SELECT a.id, b.id FROM contacts a JOIN contacts b ON b.id = a.manager_id
   WHERE a.id = b.manager_id AND a.id < b.id;
   SELECT id FROM contacts WHERE manager_id = id;              -- silently skipped by the guard
   SELECT count(*) FROM contacts WHERE manager_id IS NOT NULL AND manager_id <> id;  -- must equal rows inserted
   ```
   Default posture: **accept** cross-company and cyclic links (the new reads are one level
   deep; the cycle check only blocks *new* writes) and record it in the ADR. Only add a
   corrective `DELETE` if the pre-flight shows something alarming.

4. `bun run db:migrate` wraps **all** pending migrations in one transaction
   (`PgDialect.migrate`), so a failing backfill or CHECK rolls the whole thing back — no
   half-applied state. Then verify: `DROP COLUMN` is last, all four `CREATE UNIQUE INDEX`
   lines carry their `WHERE`, **no `$1` appears anywhere**, and a second `db:generate` reports
   no changes (proving the snapshot round-trips the partial predicates).

---

## Validation

`assertValidContactRelationship(tx, { kind, contactId, relatedContactId })` does one two-row
read (`inArray(contacts.id, [a, b])`) and returns both `companyId`s for revalidation. Takes an
`Executor` so it shares the insert's transaction snapshot — the alias pattern already exists
verbatim in `confirmRolesOnWon.ts:9`.

| rule | kind | verdict |
|---|---|---|
| self-link | all | Reject (zod `.refine` + CHECK backstop) |
| both endpoints exist | all | Reject "That contact no longer exists."; FK is the race backstop |
| **same company** | `reports_to` | Reject cross-company **and** reject when either side's `companyId` is NULL — preserving `assertValidManager`'s exact messages |
| **different company** | `succeeds` | Reject when both `companyId`s are non-null **and equal** — two records at the same company aren't a succession, they're a duplicate contact. NULL is **permissive** (unknown employer isn't evidence of sameness; and a bare `!=` on a nullable column is the NULL trap `searchContacts` already documents) |
| **cycle** | `reports_to`, `succeeds` | Reject. One bounded walk serves both (each is a single-outgoing-edge graph): follow that kind's edge from `relatedContactId`; reject on reaching `contactId` **or** on exhausting `MAX_CHAIN_DEPTH = 32` with edges left (= the data already loops). No `WITH RECURSIVE` — the repo has zero precedent, each hop is an index lookup on the partial unique, typical depth is 1–3. The depth cap is load-bearing: without it a backfilled cycle spins. |
| predecessor already has a successor | `succeeds` | **Not** app-checked — `..._one_successor_uq` catches it and the mapper words it. Don't put a correlated `NOT EXISTS` into a type-ahead query. |

`assertValidManager` is **deleted** from `contactChecks.ts` (both callers lose `managerId`);
`mapContactEmailConflict` stays.

**Race honesty:** these checks are reads, so two concurrent requests can both pass. The
partial uniques close that for cardinality; same-company and cycles keep ADR 0022/0019's
documented app-level posture.

---

## Actions

All three gated `permission: { crm: ["edit"] }` — no `metadata.authorize`, and that's
consistent rather than an omission: CRM rows are org-wide with no per-row ownership, exactly
like the three `*CompanyContactRelationship` actions. **For the RBAC audit:**
`createContactRelationship` writes `contacts.isActive` as a side effect, and `crm.edit` is
already the capability `updateContactField` requires to write that same column — no escalation.
`searchContacts` keeps its `crm.edit` gate, so `includeInactive` can't enumerate anything the
page gate didn't already permit.

**`createContactRelationship`** — one `db.transaction` (used in 38 places already) wrapping
validate → insert → `succeeds` side effect, so the checks read the snapshot the insert writes
and the succession can't half-apply:

```ts
if (kind === "succeeds") {
  // A succession says the predecessor record is history: the same human is now
  // the `contactId` row at their new employer. Atomic with the link, so there is
  // no state where the chain exists but the old record still shows up in the
  // pickers and the default contacts list.
  await tx.update(contacts).set({ isActive: false })
    .where(eq(contacts.id, relatedContactId));
}
```
Wrap the **`db.transaction` call** in the `try`, not the inner insert — the driver error
surfaces from the transaction (postgres.js rolls back and rethrows the original
`PostgresError`, so `pgErrorFields`' cause-walk still finds the SQLSTATE). `UserSafeActionError`
from the checks propagates unchanged; `mapContactRelationshipConflict` must rethrow anything
it doesn't recognise.

`mapContactRelationshipConflict(error, kind)` → per-constraint messages:
`..._one_manager_uq` "This contact already has a manager — remove the current one first." ·
`..._one_predecessor_uq` "This contact is already linked to a previous record." ·
`..._one_successor_uq` "That contact is already succeeded by someone else." ·
`..._related_uq` "These contacts are already linked — edit the existing link instead." ·
`isForeignKeyViolation` "That contact no longer exists."

**`updateContactRelationship`** — description only, `WHERE id = ? AND kind = 'related'` so a
directional row can't be given a description; `.returning()` both endpoints +
`assertRowExists`.

**`deleteContactRelationship`** — the shape of `deleteCompanyContactRelationship.ts`.

**Deleting a `succeeds` link does not reactivate the predecessor.** `isActive` is an
independent fact about a person ("we no longer deal with them"), not a derivation of the link;
auto-reviving them would surprise, and if the link was a mistake they're probably still
inactive. So Former must not be a one-way trap: extend the existing `updateContactField`
discriminated union with an `isActive` variant (that union is exactly what owner / location /
relationshipStrength already use) and give it a small toggle in the sidebar. The remove-confirm
copy must then *not* promise reactivation.

**`revalidateContactRelationship(contactId, relatedContactId)`** in `revalidate.ts` — calls
`revalidateContact` on both (a row renders on both pages, and either page can write it).
`createContactRelationship` additionally calls `revalidateCompany` for both sides on
`succeeds`, since `isActive` renders in the employer's contact tables.

**Manager comes out of contact create/update:** drop `managerId` from
`createContact.schema.ts`'s `contactFields`, from `createContact.ts`/`updateContact.ts`'s
`.values()`/`.set()`, and drop the `assertValidManager` calls. `updateContact` writes a fixed
column list, so `isActive` is untouched by a full-record edit — good, no clobbering, but say so
in a comment (it's the mirror-image of the existing `ownerId` round-trip comment, for the
opposite reason, so someone will otherwise "fix" the asymmetry).

---

## Reads

**`searchContacts`** gains three optional args:

```ts
excludeId: z.string().min(1).nullish(),          // ne(contacts.id, …) — NULL-safe, it's the PK
includeInactive: z.boolean().optional().default(false),
withCompany: z.boolean().optional().default(false),
```

| picker | args |
|---|---|
| manager (`reports_to`) | `{ companyId: contact.companyId, excludeId: contact.id }` |
| predecessor (`succeeds`) | `{ excludeId, excludeCompanyId: contact.companyId ?? undefined, includeInactive: true, withCompany: true }` |
| related | `{ excludeId: contact.id }` |

Three things to be deliberate about:

- **`withCompany` is not optional in practice.** Every `succeeds` candidate is *the same
  person's name* — searching "Alice Reed" returns "Alice Reed", "Alice Reed", "Alice Reed".
  `searchContacts` returns `{ id, name }` and `EntityCombobox` renders `item.name` verbatim, so
  join `companies.name` and return `name: "Alice Reed — Acme"`. Widening the option type
  instead would ripple through `SearchAction`, `EntityCombobox` and `EntityMultiCombobox`. Only
  ids are submitted, so the suffix never reaches storage.
- **Defaulting `includeInactive: false` silently changes four existing pickers**
  (`contacts-combobox-field`, the two opportunity fields, the company-contact relationship
  dialog) — they stop offering former contacts. That's right (don't attach a departed person to
  a new deal) but it's a behaviour change beyond this feature; call it out in the PR. Existing
  selections keep rendering, since comboboxes display passed-in labels.
- `excludeCompanyId`'s existing `or(isNull(companyId), ne(companyId, …))` is exactly right for
  the predecessor picker — it keeps employer-less contacts, matching the permissive-NULL
  decision above.

**`getContactDetail`** — delete the `alias(contacts, "managers")` left-join and
`managerId`/`managerName`; add `isActive` to the base projection. Add **one** query to the
existing `Promise.all` covering all five buckets: `related` is symmetric, so the row lives on
whichever side created it and an `OR` across both columns is unavoidable — once you have it,
the directional kinds and the reverse lookups come along free.

```ts
const other = alias(contacts, "related_contacts");
db.select({ relationshipId, kind, ownerId: contactRelationships.contactId,
            id: other.id, name: contactNameSql(other), role: other.role,
            companyId: other.companyId, companyName: companies.name,
            isActive: other.isActive, description })
  .from(contactRelationships)
  .innerJoin(other, or(
    and(eq(contactRelationships.contactId, id), eq(contactRelationships.relatedContactId, other.id)),
    and(eq(contactRelationships.relatedContactId, id), eq(contactRelationships.contactId, other.id)),
  ))
  .leftJoin(companies, eq(other.companyId, companies.id))
  .where(or(eq(contactRelationships.contactId, id), eq(contactRelationships.relatedContactId, id)))
  .orderBy(asc(other.lastName), asc(other.firstName))
```

INNER join because both FKs are notNull + cascade, so the other side always resolves (which
also types `name`/`isActive` non-null). Keep the redundant `where` — it's what lets the planner
pick the BitmapOr over the two plain indexes before the join. Then partition in TypeScript on
`ownerId === id` into `manager` / `directReports` / `predecessor` / `successor` /
`relatedContacts` (order inherited from the single `orderBy`). The three singletons are safe
because the partial unique indexes — not the code — make "at most one" true.

**Keep the succession read to one hop.** Return only the immediate predecessor and successor;
a chain view is a future feature, and a recursive CTE in service of a 320px rail is not the
trade.

**`getContactsPage`** — `ContactListFilters` gains `includeInactive?: boolean`; `contactsWhere`
pushes `eq(contacts.isActive, true)` unless set. That one `where` feeds both the `count()` and
the rows, so `total`/`pageCount` follow the toggle automatically. Add `isActive` to `ContactRow`
for the badge. Nothing manager-related changes here — **`getContactsPage` has no manager at
all** (ADR 0022 and `docs/domains/crm.md:33` both claim it self-joins for `managerName`; both
are stale and get fixed).

**`getCompanyDetail`** never reads `managerId`. Add `isActive` to `CompanyContact` and
`CompanyRelatedContact` so both tables can badge Former — but **do not filter inactive
contacts out of the company page.** A company's former employees are exactly what you want
there, and a predecessor's employer *is* the old company; hiding them would hide the history
this feature exists to record. Reads that project only a contact's *name* (`getOpportunity`,
board, referral queries, `openTasksByParent`) need nothing.

---

## UI

### The sidebar Relationships section

The rail is `md:w-80` (320px). `DetailSection` + `DetailTable` (which the `related-*-section`
templates use) does not fit three columns of contact names, so that template is abandoned
wholesale here. One new shared primitive in `detail-parts.tsx` — **`SidebarGroup({ label,
action, children })`**, the rail's counterpart to `DetailSection`: the sidebar's `Label`
styling with an optional right-aligned action, then stacked rows. No count in the heading, no
table, no border (`SidebarSection` owns that). `RelationshipGroup` and `RelationshipRow` stay
local to the section file.

```
──────────────────────────────────   ← SidebarSection border-t
RELATIONSHIPS                  [+]   ← SidebarGroup label + IconButton

Reports to
  Alice Reed                   [🗑]
  VP Engineering
Direct reports · 12
  Bob Chen
  … 4 more                           ← then Collapsible "Show all 12"
Previously
  Alice Reed at Acme           [🗑]
  Former record
Also connected
  Jo Patel                 [✎][🗑]
  Worked together at Acme
```

Rows are `flex items-start gap-1` with a two-line `min-w-0 flex-1` body (name link + optional
badge; muted `text-xs` second line doing double duty as role / description / `Former record`).
Icon buttons are `size-7` (overriding the `size="icon"` `size-9` through tailwind-merge) and
**always visible, never hover-revealed** — `contact-tasks-cell.tsx` establishes that aversion,
and hover-only is dead on touch. Placement: exactly where the Manager `MetaField` was, second
in the rail, adjacent to Company (which scopes `reports_to`).

**No per-kind badge or icon.** Three badge colours would fight the monochrome palette and eat
the width names need. **The group caption is the kind, and every caption is phrased from this
contact's point of view**, so direction needs no row-level copy: `Reports to` /
`Direct reports · 12` / `Previously` / `Moved to` / `Also connected`. Succession rows append
the company as plain text (`Alice Reed at Acme`) — the caption *and* the company are what
distinguish "continues" from "moved to", and a second link in a 320px row is mush. Full
sentences (confirms, tooltips) come from helpers in `src/lib/crm/contact-relationship.ts` so
they can't drift.

12 direct reports: render `SIDEBAR_REPORTS_PREVIEW = 5`, rest in the vendored `Collapsible`
(already the projects-list disclosure primitive, so panel a11y is free). No
`max-h` + `overflow-y-auto` — a nested scroller inside a page column reads as broken.

### The dialog

**One dialog with a kind selector**, not three entry points — three buttons don't fit a 320px
header for the same click count as Add → pick Type, and the kinds share the target picker, the
action, and all the submit/error/close plumbing. `relationship-dialog.tsx` already collapses
two *sides* behind a `side` discriminator; this is the identical move.

Loose form binding per `.claude/rules/forms.md`:
`useForm<{ kind; target: EntityOption | null; description: string }>`, manual `onSubmit` that
`safeParse`s the discriminated union and routes issues via `applyServerIssues`. Two
`useAction`s both `onSuccess: onClose`. Two non-obvious requirements: **one `useMemo`'d
`searchArgs`** keyed `[kind, contactId, employerCompanyId]` (an inline object re-runs
`EntityCombobox`'s search every render — the comment at `relationship-dialog.tsx:102` exists
for this), and **`key={kind}` on the combobox plus `setValue("target", null)` on kind change**,
or switching type leaves the previous kind's query and results in the control.

Kind selector is `EnumSelect` in a `FormField label="Type"`. It has no disabled-option support,
so **unavailable kinds are omitted and explained in a muted helper line** rather than rendered
disabled: no employer → drop `reports_to`, "Add a company to this contact to record who they
report to."; manager already set → drop it, "Jane Doe already reports to Alice Reed. Remove
that link first to change it." (actionable — the row it names is visible right above).

Once a `succeeds` target is picked, a muted line under the picker, because this is the one
write with a **side effect on another record** and it must be stated before submit, not
discovered after: *"Adding this marks Alice Reed at Acme as Former."*

**Edit exists only for `related`** — decided. The only mutable column is `description`, and the
directional kinds carry none, so an "edit" on one would open a dialog with nothing editable.
Re-pointing is remove + add, which for `reports_to` is *correct*: the remove confirm is where
the org-chart consequence gets stated.

Per-row affordances: `Reports to` trash only · `Previously` trash only · `Also connected`
pencil + trash · **`Direct reports` and `Moved to` get nothing** — they're reverse rows whose
authoritative record is owned by the *other* contact (whose page is one click away), so a
remove here would silently rewrite someone else's org position, and 12 trash buttons in a rail
is 12 mis-clicks waiting to happen.

**Accepted limitation:** the selector always writes *this* contact as `contactId`, so you can't
add "X reports to me" from the manager's page — filling in a VP's 12 reports means 12 visits.
That's what makes the max-one-manager rule enforceable at the point of entry (drop the option
rather than surface a server rejection). Escape hatch if it bites: an `Add report` entry point
on the `Direct reports` caption.

### Former badge and succession prominence

`<Badge variant="secondary">Former</Badge>` in `DetailIdentity`'s `title` slot (already
`flex flex-wrap items-center gap-2`, the same slot the company page badges Partner in) and in
`contacts-table.tsx`'s name cell. Never `destructive` — being former is a state, not an error.
Not on `Previously` rows: every row there is former by definition.

Asymmetric promotion, deliberately:
- **A former record *with* a successor gets a second `DetailIdentity` subtitle line** —
  *"Moved to **Alice Reed** at Globex"*. This page is a dead end reached by accident (a stale
  link, an old search result, a note from last year); the only question is "where did they go",
  and it must not be four sidebar sections down.
- **A current record with a predecessor gets nothing extra** — the `Previously` sidebar row is
  enough. You're already in the right place; the history is context, not a redirect.

### Contact dialogs

Both `add-contact-dialog.tsx` and `edit-contact-dialog.tsx` lose the same six things (the
`ManagerComboboxField` import, `managerName` state, `managerId` from `defaultValues`, the whole
`Controller name="managerId"` block, `useWatch` + the `companyId` watch, and `setValue` plus the
two reset lines inside `CompanyComboboxField`'s `onChange`) — ≈35 lines apiece. `edit` also
needs a muted line under the company picker when `reportsTo !== null`: *"Changing the company
will clear who Jane Doe reports to."*

That warning is load-bearing, because **an employer change can otherwise strand a `reports_to`
row cross-company** — `assertValidContactRelationship` runs at write time only, and the old
picker sidestepped this by resetting `managerId` on every company switch. So `updateContact`
must delete the contact's `reports_to` row when `companyId` changes. Without that, the sidebar
will show manager rows the write path would have rejected.

### Contacts list filter

Follows the app's URL-backed pattern exactly (`buildListHref`, values from the `params` prop,
never `useSearchParams`, page reset to 1). A `Switch` labelled **"Include former"** — the same
shape `LocationFilterControl` and `staff-directory.tsx` use for a boolean — with param
`former=1` (mirroring `nearby=1`, so absent is the default and `buildListHref`'s null-drops-key
works untouched). First row, after `SearchFilter`, before Clear. `hasFilters` gains
`|| currentFormer` so Clear appears when only the toggle is on. Leave the `filtered` prop
alone — it tunes the empty-state copy and means "narrowed"; this widens.

### Empty states and gating

All-groups-empty + `canEdit` → header, Add button, and a plain
`<p className="text-sm text-muted-foreground">`: *"No relationships yet — who they report to, a
former record, or anyone else they're tied to."* Not `TableEmpty`/bordered `EmptyState` — a
bordered box in a 320px rail reads as a broken table. All-empty + `!canEdit` → **render
nothing**; no dead section in a narrow rail. Per-group empties don't exist (groups render only
when non-empty, like the company page's pipeline sections).

Write down one consequence so nobody "restores" it: a non-editor viewing a relationship-less
contact now sees **no Manager row at all**, where today they see `Manager —`. That's intended
fallout of removing the field, and it's a deliberate break from `MetaField`'s
always-show-an-em-dash convention (that's for a scalar fact with a stable slot; this is a
collection with an action).

Tooltips, since icon-only buttons must carry what the icon can't: `Add relationship` ·
`Remove manager` · `Remove succession link` · `Edit connection` / `Remove connection`. Confirms
are one `ConfirmDialog` switched on `removing.kind`, all `destructive`, `confirmLabel="Remove"`
— and the `succeeds` one must **not** promise reactivation.

### One UX flag

The `succeeds` flow needs two contact records, and `contacts.email` is unique — so creating the
new record with the person's old email hits `contacts_email_unique` → "A contact with that email
already exists.", which is misleading here (they *should* get the new work email). Worth a line
of help text.

---

## Seed

- `scripts/seed/wipe.ts` — add `"contact_relationships"` to `SEEDABLE_TABLES` in the `// crm`
  block **above `"contacts"`** (the list reads child → parent).
- `scripts/seed/crm.ts` — replace the `contact.managerId = …` assignment (lines 82-89, whose
  "report to an *earlier* peer" comment doesn't match its code — it only guards self, so 2-cycles
  are reachable) with `contactRelationships` rows: `reports_to` within a company, a handful of
  `succeeds` pairs across companies (marking the predecessor `isActive: false` so the seed
  matches what the action produces), and some `related` rows with
  `RELATED_DESCRIPTION_SUGGESTIONS`. Guard the cardinality rules in the generator with `Set`s,
  the way the existing `seenPairs` guard does — the partial uniques will otherwise abort the seed.
- `scripts/seed.ts` — add the new count to the destructure and the summary log.

## Docs (dispatch the `librarian` after implementation)

New ADR superseding **ADR 0022** (contact manager self-reference), alongside ADR 0048; add the
`docs/decisions/README.md` row. Reconcile `docs/data-model.md`, `docs/domains/crm.md`
(`#relationships`), and `docs/ui.md`. Three doc statements are **already stale before this
change** and should be fixed in the same pass:
`docs/ui.md:218` "Contact form is create-only — there's no edit flow" (`edit-contact-dialog.tsx`
exists and is wired at `contact-detail-view.tsx:145`) · `docs/ui.md:219` the whole
`ManagerComboboxField` paragraph (component is deleted) · `docs/domains/crm.md:33` + ADR 0022's
claim that `getContactsPage` self-joins for `managerName` (it has no manager at all).

---

## Verification

1. **Migration** — the four verifications in step 4 above, then `bun run db:generate` again and
   confirm no changes. Confirm the backfilled `reports_to` row count matches the pre-flight
   `count(*)`, and spot-check that a previously-managed contact still shows its manager.
2. `bun run check` (Biome + `tsc --noEmit` + `bun test`) and `bun run build`. The permissions
   matrix test runs inside `check`; the seed imports the real tables, so a stale seed shows up
   as a `check` failure.
3. `bun run db:seed` — must complete without tripping a partial unique or a CHECK.
4. **`/audit-rbac`** — it should confirm three new gated actions, the new `updateContactField`
   variant, and no new ungated path (see the escalation note above).
5. **End-to-end in the app** (`bun run dev`, use the `run` skill):
   - Set a manager from the sidebar; confirm it appears as `Reports to` on this contact and as
     `Direct reports` on the manager's page.
   - Try to set a second manager (option is gone), a self-link (picker excludes), a
     cross-company manager (rejected), and a 2-cycle A→B then B→A (rejected with the loop
     message).
   - Create a contact at a new company, link `succeeds` to the old record: the dialog warns
     first; after submit the old record shows the **Former** badge and *"Moved to …"* in the
     identity block, the new record shows `Previously … at Acme`, the old record leaves the
     default contacts list, and **Include former** brings it back badged.
   - Confirm the predecessor picker can find that now-inactive contact (`includeInactive`) and
     that its options are disambiguated by company (`withCompany`).
   - Add a `related` link, reword it (edit works), and confirm it renders once — not twice —
     from *both* contacts' pages.
   - Change the employer of a contact who has a manager: the warning shows and the
     `reports_to` row is gone afterwards.
   - As a user without `crm.edit`: no Add, no pencils, no trashes; a relationship-less contact
     shows no Relationships section.
6. **`/code-review`** and **`/security-review`** before merging.
