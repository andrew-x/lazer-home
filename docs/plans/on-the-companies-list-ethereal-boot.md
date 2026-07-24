# Companies list enhancements + company-level notes

## Context

The `/companies` list is minimal today: a two-column table (Name, Status) with only
Prev/Next pagination and no way to search or filter. As the company set grows this is
hard to navigate. Separately, companies are the one CRM entity with **no notes** —
contacts and opportunities each keep a running, authored log of timestamped entries,
but companies have nowhere to track relationship notes.

This change makes the list denser and navigable (compact rows, numbered pagination,
name search, single status filter) and gives companies the same running notes log the
rest of CRM already uses, shown on the company detail page below the tabs.

Decisions confirmed with the user:
- **Notes** = a **running entry log** (reuse `EntryLog`), not a single text field.
- Notes render **inline below the tabs** (a separator above), not inside a tab.
- Status filter is **single-select** (Partner / Client / Prospect / All).

Key fact that shapes the status filter: **companies have no stored `status`.** The tags
are *derived* — `partner` = the stored `companies.isPartner` flag; `client` = has ≥1
confirmed project; `prospect` = has ≥1 open opportunity — and a company can carry
several at once. See `src/lib/crm/company-status.ts` and the `exists(...)` expressions
in `getCompaniesPage.ts`.

---

## 1. Compact table

**File:** `src/components/crm/companies-table.tsx`

The shared `Table` primitives in `src/components/ui/table.tsx` are vendored (don't
hand-edit). Tighten rows *scoped to this table* by passing a smaller vertical padding
class on each `TableHead`/`TableCell` (e.g. `className="py-1.5"`) — `cn`/tailwind-merge
lets `py-1.5` override the primitives' `p-2`. Horizontal `px-2` stays. No shared-component
change.

## 2. Pagination with page numbers

**File:** `src/components/pagination-controls.tsx` (shared — also used by the
opportunities list; the numbered upgrade benefits both, intentionally)

Keep the Prev/Next buttons and the `buildHref` helper. Between them, render a windowed
list of numbered page `<Button>`s (each an `<a>` via `render={<Link .../>}`), with the
current page shown as `variant="default"` (others `variant="outline"`), and `…`
placeholders when `pageCount` is large. Add a small pure helper
`pageWindow(page, pageCount)` returning e.g. `[1, "…", 5, 6, 7, "…", 20]` (always show
first, last, and a window around current). Single page → no numbers.

## 3. Search + single status filter

**New client component:** `src/components/crm/companies-list-filters.tsx` — mirror
`src/components/crm/opportunities-list-filters.tsx` almost verbatim:
- `"use client"`, reads the already-parsed `params` (no `useSearchParams`).
- Debounced (300ms) name search bound to URL param `q`, with the `IconSearch` input.
- A `SelectFilter` (from `src/components/form/filters.tsx`) for **Status**, options =
  `COMPANY_STATUS_TAGS`, labels = `COMPANY_STATUS_LABELS` (from
  `src/lib/crm/company-status.ts`), URL param `status`, `ALL` sentinel.
- `hrefWith(params, updates)` helper that always resets `companiesPage` to 1 on any
  filter change and preserves other params. "Clear filters" button navigates to
  `/companies`.

**Read fn:** `src/actions/crm/getCompaniesPage.ts`
- Extend the signature to accept a `filters` object, e.g.
  `getCompaniesPage(page, filters: { query?: string; status?: CompanyStatusTag }, pageSize?)`.
- Build a `SQL[]` of conditions and `and(...)` them:
  - search → `ilike(companies.name, `%${query}%`)` (case-insensitive, mirrors the
    opportunities read).
  - status → `partner`: `eq(companies.isPartner, true)`; `client`: the confirmed-project
    `exists(...)`; `prospect`: the open-opportunity `exists(...)`.
- **Refactor:** extract the two correlated `exists(...)` expressions into raw condition
  consts (e.g. `hasConfirmedProject`, `hasOpenOpportunity`) and apply `.mapWith(Boolean)`
  only where they're used in the `select` (as `isClientExpr`/`isProspectExpr`), so the
  same raw expression is reused in the `where`. Keep the existing LOCKSTEP comment with
  `project-derived.ts`.
- **Apply the same `where` to BOTH the `count()` and the rows query** so the filtered
  total drives pagination (today the count is unconditional — must not stay that way once
  filtering exists).
- `CompanyStatusTag` comes from `company-status.ts` (`COMPANY_STATUS_TAGS[number]`).

**Page:** `src/app/(app)/companies/page.tsx`
- Parse `params.q` (string) and `params.status` (validate against `COMPANY_STATUS_TAGS`,
  ignore anything else), pass them into `getCompaniesPage`.
- Render `<CompaniesListFilters params={params} />` above the bordered table wrapper.
- `PaginationControls` already forwards all other params via `buildHref`, so search/status
  survive page changes with no extra work.

## 4. Company notes — a running entry log (new `company` variant)

Companies get the same entry-log machinery contacts/opportunities have. New table +
actions + read + a third `EntryLog` variant.

**Schema:** `src/lib/db/crm-schema.ts`
- Add `companyEntries` table mirroring `contactEntries`: `id`, `companyId`
  (`.references(() => companies.id, { onDelete: "cascade" }).notNull()`), `kind`
  (`crmEntryKind`), `body` (notNull), `authorStaffId` (set-null), `createdAt`/`updatedAt`,
  and index `company_entries_company_kind_created_idx` on `(companyId, kind, createdAt)`.
- Add `export type CompanyEntry = InferSelectModel<typeof companyEntries>`.
- `src/lib/db/schema.ts` re-exports the module wholesale — no change needed there.
- Then: `bun run db:generate` → `bun run db:migrate`.

**Shared schema:** `src/actions/crm/entries.schema.ts`
- Add `addCompanyEntrySchema = z.object({ companyId: id, kind: entryKindSchema, body }).superRefine(refineEntryBody)`
  and its `AddCompanyEntryInput` type (mirror the contact one). `updateEntrySchema` /
  `deleteEntrySchema` are parent-agnostic and reused as-is.

**Actions:** `src/actions/crm/` — add three, mirroring the contact trio:
- `addCompanyEntry.ts` — `permission: { crm: ["edit"] }`, resolve author via
  `resolveAuthorStaffId`, `generateId("coentry")`, FK-violation → "That company no longer
  exists.", `revalidatePath('/companies/${companyId}')` + `revalidatePath("/companies")`.
- `updateCompanyEntry.ts` / `deleteCompanyEntry.ts` — same shape as the contact versions
  but `.returning({ companyId: companyEntries.companyId })` and revalidate the company
  paths. Same `crm.edit` gate; same "any editor may amend any entry" product rule.

**Read:** `src/actions/crm/entryViews.ts`
- Add `getCompanyEntries(companyId): Promise<EntryLogData>` mirroring `getContactEntries`
  (left-join `staff` for author name, newest-first). Reuses the existing `toLogData`.

**Component:** `src/components/crm/entry-log.tsx`
- Widen `variant` to `"contact" | "opportunity" | "company"`.
- Add the `addCompanyEntry` `useAction` hook alongside the existing two; generalize the
  `add`/`update`/`remove` selection from the current binary ternary to cover the third
  variant, and add a `company` branch in `submitAdd`
  (`addCompany.execute({ companyId: parentId, kind, body })`). Import the three company
  actions.

**Detail view:** `src/components/crm/company-detail-view.tsx`
- Add a `notes: EntryView[]` prop.
- After `</Tabs>` (as a sibling in `DetailLayout`'s main column), add a `<Separator />`
  (`src/components/ui/separator.tsx`) then a `<DetailSection title="Notes">` containing
  `<EntryLog variant="company" parentId={company.id} kind="note" entries={notes} canEdit={canEdit} />`.
  This satisfies "notes below the tabs with a separator above." (Company notes use the
  `note` kind only — no next-step composer here.)

**Detail page:** `src/app/(app)/companies/[id]/page.tsx`
- Add `getCompanyEntries(id)` to the existing `Promise.all`, pass `notes={entries.notes}`
  into `<CompanyDetailView />`.

**Seed:** `scripts/seed/entries.ts` + `scripts/seed.ts`
- Extend `seedEntries` to accept `companies` and insert a handful of `note`-kind
  `companyEntries` per company (reuse `makeEntry("coentry", "note", staff)`), returning a
  `companyEntries` count. Wire the `companies` array through from `scripts/seed.ts`. Keeps
  `bun run db:seed` / `bun run check` green (the seed imports the real tables).

## 5. Docs

After implementation, dispatch the **`librarian`** subagent with a summary (new
`companyEntries` table + company entry-log variant; companies list search/status-filter/
numbered pagination) to reconcile `docs/domains/crm.md` and the data model.

---

## Permissions note

All new mutations reuse the exact `crm.edit` gate the contact/opportunity entry actions
declare in metadata — no new roles, no ownership nuance, nothing hand-written in bodies.
No permission surface changes.

## Verification

1. `bun run db:generate && bun run db:migrate` — migration applies cleanly.
2. `bun run db:seed` — reseeds without type errors (proves the seed matches the new schema).
3. `bun run check` (Biome + `tsc` + tests) and `bun run build`.
4. `bun run dev` and exercise `/companies`:
   - Rows read more compact; numbered pagination shows and navigates; each page link
     preserves active filters.
   - Type in search → list narrows by name (debounced); Status select filters to
     Partner/Client/Prospect; the page count/total reflect the filtered set; Clear resets.
5. Open a company detail page: below the two tabs, a separator then a **Notes** log.
   Add / edit / delete a note as a `crm.edit` user; confirm it persists across refresh and
   shows author + date. Confirm a non-editor sees the log read-only (no composer).
