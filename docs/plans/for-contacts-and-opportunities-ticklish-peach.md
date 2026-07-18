# Notes & Next Steps for Contacts and Opportunities

## Context

Sales users need running, dated commentary on the people and deals they work. Today
that surface barely exists: **opportunities** have a single scalar `nextSteps` text
field (inline-editable in the detail drawer), and **contacts** have nothing. There is
no way to keep a history of what happened and what's next.

This change adds two kinds of **timestamped, authored free-text entries** to both
contacts and opportunities:

- **Notes** — longer free text, a running log of what happened.
- **Next steps** — shorter free text, a running log of what's planned next.

Both are append-a-new-dated-entry logs (a CRM-style activity feed), shown newest-first
with author + date. The **most recent next step** surfaces in the list views so users
see it at a glance without opening a record.

Decisions locked with the user:
- Structure: **timestamped log** (multi-entry), not single fields.
- List display: show the **most recent next-step** entry with its date.
- Edit/delete: **anyone with `crm.edit`** may edit/delete any entry (no per-entry ownership check).
- The existing scalar `opportunities.nextSteps` is **migrated into the new log** (as the first entry) and the column is **dropped**.

Also requested, and folded in: the **contacts table** is reduced to columns
**Name · Company · Role · Next steps** (dropping Email, Phone, Manager, LinkedIn from
the *table* — they remain on the contact detail page).

## Data model

Two new child tables — one per parent entity (concrete FKs, per repo convention; no
polymorphic FK). Both share an identical shape and a shared `kind` enum, so notes and
next steps differ only by `kind` + validation length.

New enum in `src/lib/db/crm-schema.ts` (or a small `crm-enums.ts`), following the
per-domain enum precedent (`staff-enums.ts`):

```ts
export const crmEntryKind = pgEnum("crm_entry_kind", ["note", "next_step"]);
```

New tables (mirror the `feedback` table in `performance-schema.ts` — authored,
point-in-time, indexed FKs):

- **`contactEntries`** in `src/lib/db/crm-schema.ts`
- **`opportunityEntries`** in `src/lib/db/opportunities-schema.ts`

Columns for each (camelCase keys, `casing: "snake_case"` derives column names):
- `id: text().primaryKey()` — minted with `generateId("centry")` / `generateId("oentry")` (`src/lib/db/ids.ts`).
- `contactId` / `opportunityId`: `text().references(() => parent.id, { onDelete: "cascade" }).notNull()`.
- `kind: crmEntryKind("kind").notNull()`.
- `body: text().notNull()`.
- `authorStaffId: text().references(() => staff.id, { onDelete: "set null" })` (nullable — author attribution, survives staff deletion).
- `createdAt: timestamp().defaultNow().notNull()`.
- `updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull()`.
- Index on `(parentId, kind, createdAt)` for the newest-per-kind reads.

Add both to the `src/lib/db/schema.ts` barrel. Export row types via
`InferSelectModel<typeof contactEntries>` etc.

### Migration (data-preserving)

1. `bun run db:generate` after editing schema — creates the two tables.
2. **Hand-edit the generated migration** to add a backfill before dropping the column:
   `INSERT INTO opportunity_entries (id, opportunity_id, kind, body, created_at, updated_at) SELECT <generated ids>, id, 'next_step', next_steps, now(), now() FROM opportunities WHERE next_steps IS NOT NULL AND btrim(next_steps) <> '';`
   (Generate the ids in SQL, e.g. via `gen_random_uuid()::text` prefixed, or backfill in a
   tiny script — ids only need to be unique, not CUID2, for legacy rows.)
3. Drop the `opportunities.next_steps` column in the same migration.
4. `bun run db:migrate`.

## Server actions & reads (`src/actions/crm/`)

Follow the layer conventions: mutations are `'use server'` `secureActionClient` actions
(one per file) with a separate `*.schema.ts`; reads are `import "server-only"` functions.
Every mutation gates on `permission: { crm: ["edit"] }` (declared in `.metadata`, enforced
before the body). No hand-written auth. `revalidatePath` after each mutation.

**Validation** (`*.schema.ts`, reuse `src/lib/text-schema.ts` where it fits; add a small
required-trimmed helper if absent): `body` is required, trimmed, non-empty. Max length by
kind — notes large (e.g. 5000), next steps small (e.g. 500). `kind` via `z.enum`.

New mutations (per entity — `contact` and `opportunity` variants):
- `addContactEntry.ts` / `addOpportunityEntry.ts` — resolve author via
  `getCurrentStaffAccess(ctx.user)` (`src/actions/staff/getCurrentStaffAccess.ts`),
  `generateId`, insert. Never trust a client-supplied author id.
- `updateContactEntry.ts` / `updateOpportunityEntry.ts` — edit `body` by entry id.
- `deleteContactEntry.ts` / `deleteOpportunityEntry.ts` — delete by entry id.

**Reads:**
- Extend `getContactDetail.ts` and `getOpportunity.ts` to also return `notes[]` and
  `nextSteps[]` (each newest-first, joined to the author's name). These feed the detail views.
- Extend `getContactsPage.ts` (`ContactRow`) and `getOpportunitiesBoard.ts`
  (`OpportunityBoardCard`) to include the **latest next-step** entry (`body` + `createdAt`)
  via a correlated subquery / lateral join filtered to `kind = 'next_step'` ordered by
  `createdAt desc limit 1`. Remove the old `nextSteps` selection from `getOpportunity.ts`.

## UI

**Shared entry-log component** (new, e.g. `src/components/crm/entry-log.tsx`): renders a
newest-first list of `{ id, body, authorName, createdAt }` with an add-entry composer
(`Textarea` + submit) and per-entry edit/delete controls (both shown to any `crm.edit`
user). Model the composer on `src/components/feedback/feedback-form.tsx` and the form
primitives in `src/components/form/` (`FormDialog`/`FormField`/`Textarea`, `useAction`).
Wrap with `DetailSection` + `TableEmpty` from `src/components/crm/detail-parts.tsx`.
Dates via `formatTimestamp` in `src/lib/format.ts` (add a compact date+time variant if the
long format reads poorly; keep it `Intl`-based — do not add a date library).

- **Contact detail** (`src/components/crm/contact-detail-view.tsx`): add two
  `DetailSection`s in the main column — "Notes" and "Next steps" — each an `EntryLog`.
  (Email/phone stay in the sidebar; only the *table* loses them.)
- **Opportunity detail** (`src/components/crm/opportunity-detail-sheet.tsx`): remove the
  scalar `NextStepsField` (lines ~689-719) and its `nextSteps` case in
  `updateOpportunityField.*`; also drop `nextSteps` from `opportunityBaseFields` /
  `createOpportunity` create form. Add "Notes" and "Next steps" `EntryLog`s — either two
  sections in the Info tab or a third "Notes" tab (add a trigger to the `TabsList` ~172-175).
- **Contacts table** (`src/components/crm/contacts-table.tsx` + `ContactRow` in
  `getContactsPage.ts`): reduce columns to **Name · Company · Role · Next steps**. Next
  steps cell shows the latest entry body + date (or `EmptyCell` when none). Drop the Email,
  Phone, Manager, LinkedIn columns and their projections.
- **Opportunity card** (`src/components/crm/opportunity-card.tsx`): add a "next steps" line
  to the card content (latest entry, truncated) with `createdAt`; select the field into
  `OpportunityBoardCard`.

## Seed (`scripts/seed/`)

- `scripts/seed/wipe.ts`: add `contact_entries` and `opportunity_entries` to
  `SEEDABLE_TABLES` (child-before-parent order).
- `scripts/seed/crm.ts`: insert a few synthetic entries (both kinds) per contact and
  opportunity using `generateId` + `faker`, with `authorStaffId` from seeded staff. Since
  the scalar `nextSteps` column is gone, remove it from the opportunity seed rows.

## RBAC / docs

- All new mutations gate on `crm.edit` — no matrix change needed (reuse existing
  capability). Confirm with `bun run check` (runs the permission matrix test).
- After implementation, dispatch the **librarian** subagent to reconcile
  `docs/domains/crm.md` (+ data-model if entities are diagrammed) with the new tables and
  the dropped `opportunities.nextSteps` column.

## Verification

1. `bun run db:generate` && `bun run db:migrate` && `bun run db:seed` — schema + backfill
   apply cleanly; seed populates entries.
2. `bun run check` — Biome + `tsc` + tests (incl. permission matrix, seed compile) green.
3. `bun run build` — production build/type-check.
4. Drive the app (`bun run dev`, use the `run`/`verify` skills):
   - Contact detail: add a note and a next step; confirm newest-first, author + date,
     edit and delete work.
   - Contacts list: columns are Name/Company/Role/Next steps; latest next step shows with
     its date; empty state renders for a contact with none.
   - Opportunity drawer: notes + next steps logs work; the old single next-steps field is
     gone; a pre-existing opportunity shows its migrated next step as the first entry.
   - Opportunity board card: latest next step appears.
   - Permissions: a `staff`/read-only user (no `crm.edit`) cannot add/edit/delete entries.
