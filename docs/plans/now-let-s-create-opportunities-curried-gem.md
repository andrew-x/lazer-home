# CRM Opportunities

## Context

The CRM currently has Companies and Contacts (create + read, one page). The next
pipeline entity — **Opportunity** — is specced-but-unbuilt in `docs/domains/crm.md`
("a pipeline deal for a Company, moving through stages"). This adds it as a third
CRM section: an `/opportunities` page with a table and an "Add opportunity" dialog,
mirroring the Companies/Contacts pattern.

An opportunity has: **name**, a required **company**, a list of **contacts**, a list
of **owners** (staff), a **source** enum, a list of **sourceContacts** (contacts,
only relevant for contact-referral), a list of **sourceStaff** (staff, only relevant
for staff-referral), free-text **next steps**, and a **status** enum.

Decisions confirmed with the user:
- `sourceContacts` references **CRM contacts** (not staff), inline-creatable.
- The 4 list relations use **junction tables** (this establishes the repo's first
  join-table pattern; the data-model doc already anticipates it for Allocations).
- Company is **required**.
- Companies and contacts are **searchable or inline-creatable**; **staff are search-only**
  (never created inline).
- Write access reuses the existing CRM-write capability, **renamed `contacts` → `crm`**
  so one capability covers companies + contacts + opportunities.

Conditional rule: `source = staff_referral` ⇒ at least one sourceStaff; `source =
contact_referral` ⇒ at least one sourceContact.

## 1. Schema — `src/lib/db/crm-schema.ts`

Add two `pgEnum`s, the `opportunities` table, and four junction tables. Enum tuples
are declared once in `createOpportunity.schema.ts` (pure zod, client-safe) and
imported here so the pgEnum and the zod enum share one source of truth.

```ts
export const opportunitySourceEnum = pgEnum("opportunity_source", [...OPPORTUNITY_SOURCES]);
export const opportunityStatusEnum = pgEnum("opportunity_status", [...OPPORTUNITY_STATUSES]);

export const opportunities = pgTable("opportunities", {
  id: text().primaryKey(),                    // generateId("opp")
  name: text().notNull(),
  companyId: text().notNull().references(() => companies.id, { onDelete: "restrict" }),
  source: opportunitySourceEnum().notNull(),
  status: opportunityStatusEnum().notNull(),
  nextSteps: text(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
});
```

- Source values: `inbound, farming, extension, change_request, staff_referral, contact_referral`.
- Status values: `maturing, lead, qualifying, scoping, closing, closed_lost, closed_won`.
- `companyId` uses `onDelete: "restrict"` — company is required, so a company with
  live opportunities must not be deletable (deliberately differs from `contacts.companyId`,
  which is `set null` because a contact's company is optional).

Four junction tables, each following the same shape (surrogate `text` PK via
`generateId`, a `unique(...)` on the FK pair, an `index(...)` on the non-opportunity
FK — consistent with the repo's all-surrogate-PK convention; no composite PKs).
Both FKs `onDelete: "cascade"` (a link is meaningless without both endpoints):

| table | 2nd FK → | `generateId` prefix |
|---|---|---|
| `opportunity_contacts` | `contacts.id` | `opp-contact` |
| `opportunity_owners` | `staff.id` | `opp-owner` |
| `opportunity_source_contacts` | `contacts.id` | `opp-src-contact` |
| `opportunity_source_staff` | `staff.id` | `opp-src-staff` |

Export `Opportunity` (and the junction) row types via `InferSelectModel`. `schema.ts`
already does `export * from "./crm-schema"` — no barrel edit needed.

Then: `bun run db:generate` → review `drizzle/0014_*.sql` (2 enum types + 5 tables,
FK actions) → `bun run db:migrate` (remote Postgres; no local DB).

## 2. Server layer — `src/actions/crm/`

**`createOpportunity.schema.ts`** (pure zod, client-importable): exports
`OPPORTUNITY_SOURCES` / `OPPORTUNITY_STATUSES` tuples and `createOpportunitySchema`
— `name` (trim, 1–200), `companyId` (min 1), `contactIds`/`ownerIds`/
`sourceContactIds`/`sourceStaffIds` (`z.array(z.string().min(1)).default([])`),
`source`/`status` enums, `nextSteps` (nullish, trimmed → null). A `.superRefine`
enforces the conditional rule, attaching issues to `sourceStaffIds` /
`sourceContactIds`. Hand-written `z.object` is correct here (cross-table shape), per
`.claude/rules/server-actions.md`.

**`createOpportunity.ts`** (`secureActionClient`, gate `{ crm: ["edit"] }`): mint
`opportunityId = generateId("opp")` up front, then one `db.transaction` — insert the
parent row, then bulk-insert each junction (dedupe each id array with `new Set`).
Four explicit insert blocks (not a generic helper — the `contactId`/`staffId` column
difference fights TS). `revalidatePath("/opportunities")`; return `{ id }`. Model on
`createContact.ts`'s transaction shape.

**`getOpportunitiesPage.ts`** (`server-only`, mirrors `getCompaniesPage.ts`):
`PAGE_SIZE = 20`, `count()`, page clamped into range, explicit column projection.
Join `companies` for the company name; resolve owner names via a grouped read of
`opportunity_owners`→`staff` (or a second query keyed by the page's opportunity ids)
so the table can show owners without N+1. Export `OpportunityRow` / `OpportunitiesPage`
types.

**`searchContacts.ts`** and **`searchStaff.ts`** (new, mirror `searchCompanies.ts`;
gate `{ crm: ["edit"] }`, debounced use, blank → `[]`, `limit(10)`): both return
`{ id, name }[]`.
- `searchContacts`: `ilike` across firstName/lastName/email; compose `name` in JS.
- `searchStaff`: `staff.name` is `notNull` on the `staff` table — no `user` join
  needed; filter `staff.isActive = true`.
- Extract the LIKE-escaper (currently private in `searchCompanies.ts`) to a shared
  `src/lib/like.ts` and reuse across all three.

**Small enabling change:** `createContact.ts` currently returns `{ ok: true }` and
discards the generated id. Hoist `const contactId = generateId("contact")` and
`return { id: contactId }` so inline-created contacts can be added to a selection.
`createCompany` already returns `{ id }`. Verify no caller depends on `{ ok: true }`
(current dialog only reads `onSuccess`).

## 3. UI components — `src/components/crm/`

**`entity-multi-combobox.tsx`** — a reusable multi-select built on the vendored
`ComboboxChips`/`ComboboxChip`/`ComboboxChipsInput` (multi-select primitives already
exported from `src/components/ui/combobox.tsx`). Mirrors `company-combobox.tsx`
(debounced `useAction`, `filter={null}`, keep-selected-in-list `useMemo`) but its
value is `EntityOption[]` (`{ id, name }[]`). Props: `value`, `onChange`,
`searchAction`, `placeholder`, `invalid`, and an optional `createNew: { label, onOpen }`
affordance rendered below the results. Do **not** hand-edit `ui/**`.

Thin wrappers pin action + affordance (same way `CompanyCombobox` pins
`searchCompanies`):
- `ContactsMultiCombobox` → `searchContacts` + `createNew` (inline create).
- `StaffMultiCombobox` → `searchStaff`, **no** `createNew` (staff are search-only).

**`add-opportunity-dialog.tsx`** — `"use client"`, mirrors `add-contact-dialog.tsx`
(Dialog, `formKey` remount-on-open, server errors from `action.result.serverError`,
`Button loading={action.isPending}`). Uses **loose binding** (`useForm` + `useAction`,
per `.claude/rules/forms.md`) because the form holds `EntityOption[]` per picker but
the action wants `string[]` — map to ids in `onSubmit` before `execute`. Fields:
- **name** — text input.
- **company** — required single picker. Reuse `CompanyCombobox`; add an inline-create
  toggle (the "New company" ↔ "Pick existing" pattern already in `add-contact-dialog.tsx`),
  persisting via `createCompany` and holding the returned `{ id, name }`.
- **contacts / sourceContacts** — `ContactsMultiCombobox`; `createNew` opens a small
  create-contact dialog reusing `createContact` (now returns `{ id }`); on success
  append `{ id, name }` to the field. Use `onMouseDown preventDefault` on the create
  button so the popup doesn't close first.
- **owners / sourceStaff** — `StaffMultiCombobox` (search-only).
- **source / status** — `Select` (fixed enum options).
- **nextSteps** — `Textarea`.
- Client-side mirror of the `superRefine` for inline errors; wire each picker through
  `Controller`.

**`opportunities-table.tsx`** — server component, `{ rows: OpportunityRow[] }`,
mirrors `contacts-table.tsx`. Columns: Name, Company, Status (`<Badge>`), Source,
Owners (names or count). Keep it compact — don't render every list relation.

## 4. Page + nav

**`src/app/(app)/opportunities/page.tsx`** — server component mirroring
`companies/page.tsx`: `Promise.all([getOpportunitiesPage(page), getCurrentUser()])`,
`canEdit = userHasPermission(user, { crm: ["edit"] })`, header with conditional
`<AddOpportunityDialog />`, bordered table + `PaginationControls`. Export `metadata`.

**`src/components/app-shell/nav.ts`** — add
`{ title: "Opportunities", href: "/opportunities", icon: IconTargetArrow }` to
`NAV_ITEMS` (drives sidebar + header title).

## 5. Permission rename `contacts` → `crm` (lockstep, no privilege change)

Pure key rename; sales/manager/admin keep exactly one CRM-write capability. `bun run
check` typechecks every gate against `statement`, so misses fail loudly. Change in
lockstep:
- **`src/lib/permissions.ts`** — `statement.contacts` → `crm` (update comment);
  `roles` entries for `sales`, `manager`, `admin`.
- **`src/lib/permissions.test.ts`** — `MATRIX` field `contactsEdit` → `crmEdit`; the
  `contacts.edit` test block → `crm.edit` (plain strings, not type-checked — rename by hand).
- **Action gates** — `createContact.ts`, `createCompany.ts`, `searchCompanies.ts`
  (metadata + docstrings).
- **`src/app/(app)/companies/page.tsx`** — `canEdit` flag.
- New files (`createOpportunity.ts`, `searchContacts.ts`, `searchStaff.ts`) use
  `{ crm: ["edit"] }` from the start.

**Do NOT rename** `contacts` references that mean the *table/entity* (in
`docs/data-model.md`, `docs/domains/crm.md` prose, `docs/flows.md`, ADRs,
`docs/README.md`) — only the *capability* key moves. This entity-vs-capability
distinction is the one footgun.

No DB migration for the rename (role is a `text` column, `statement` is runtime JS;
Better Auth `ac`/`roles` rebuild from `statement` at runtime — no `auth:generate`).

## 6. Docs (librarian)

After implementation, dispatch the **librarian** subagent to reconcile `/docs`:
promote Opportunity from "proposed" to "built" in `docs/domains/crm.md` and
`docs/data-model.md`; document the junction-table pattern; and update the `crm.edit`
capability across `docs/domains/permissions.md` (matrix + narrative — required in
lockstep by `.claude/rules/permissions.md`), plus the textual `contacts.edit` →
`crm.edit` references in `docs/architecture.md` and `docs/ui.md`.

## Verification

1. `bun run check` — Biome + `tsc` (also runs the permissions matrix test; catches
   any missed capability gate).
2. `/audit-rbac` — required after touching permissions.
3. `bun run build` — non-trivial feature; ensure it builds.
4. Run the app (`bun run dev`) and drive the flow end-to-end:
   - Open `/opportunities`, click **Add opportunity**.
   - Verify company picker is required and supports inline-create.
   - Add existing contacts/owners via search; inline-create a new contact and confirm
     it appears in the chips and persists.
   - Set source = **staff referral** with empty sourceStaff → submit blocked with the
     field error; add a staff member → submits. Repeat for **contact referral** /
     sourceContacts.
   - Confirm the new row appears in the table (company, status badge, source, owners)
     and pagination works.
   - As a `user`-role account, confirm the **Add opportunity** button is hidden and
     `createOpportunity` is rejected by the gate.
