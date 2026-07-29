# Non-employee company ↔ contact relationships

## Context

Today a contact's only link to a company is `contacts.companyId` — a single **employer** FK. That can't express the case we actually keep hitting: a partner company's person who works *on* one of our accounts. A CSM at a partner, an FDE embedded on a client, a former employee who still opens doors, an investor sitting on a client's board — all of them relate to a company they don't work at, and the CRM has nowhere to put it.

This adds a second, parallel notion: a **relationship** row joining one company to one contact with a short free-text description ("CSM", "FDE", …). It surfaces on both sides — a *Related contacts* section under the company page's Contacts tab, and a new *Companies* tab on the contact page — and can be created, edited, or removed from either. `contacts.companyId` stays the sole employer link and is untouched.

**Decisions taken (confirmed):**
- **One relationship per (company, contact) pair** — unique constraint; adding a duplicate is a friendly "edit the existing one instead".
- **Tight suggestion list**: CSM, FDE, Partner manager, Former employee, Investor. Hints only — the stored description is free text and nothing validates against the list.
- **Pickers pre-filter employees out** — on a company page the contact picker hides that company's own employees; on a contact page the company picker hides that contact's employer.

---

## 1. Suggestions constant — `src/lib/crm/company-contact-relationship.ts` (new)

Pure, client-importable (no db/drizzle/UI), same shape as `src/lib/crm/relationship-strength.ts`.

```ts
/**
 * Suggested labels for a non-employee company ↔ contact relationship. Hints
 * only — the stored `description` is free text and nothing validates against
 * this list (contrast the closed pgEnum tuples in `./opportunity.ts`). Pure and
 * client-importable so the dialog's autocomplete and the seed share one list.
 */
export const RELATIONSHIP_DESCRIPTION_SUGGESTIONS = [
  "CSM",
  "FDE",
  "Partner manager",
  "Former employee",
  "Investor",
] as const;
```

No label map (the value *is* the label) and no exported union type — exporting one would falsely imply the column is validated against it.

## 2. Schema — append to `src/lib/db/crm-schema.ts`

Goes right after `contacts`, before the "Timestamped entries" banner. Both FKs are local to this file and the barrel `src/lib/db/schema.ts` already re-exports `./crm-schema`, so **no barrel change**. Add `unique` to the `drizzle-orm/pg-core` import (the file already imports `index`).

```ts
export const companyContactRelationships = pgTable(
  "company_contact_relationships",
  {
    id: text().primaryKey(),
    companyId: text()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    contactId: text()
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    // How this person relates to this company — free text, with UI suggestions
    // from `@/lib/crm/company-contact-relationship`. Deliberately not a pgEnum:
    // the label set is open-ended, same reasoning as the free-text `location`.
    description: text().notNull(),

    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    unique("company_contact_relationships_unique").on(t.companyId, t.contactId),
    index("company_contact_relationships_contact_idx").on(t.contactId),
  ],
);
```

Plus `export type CompanyContactRelationship = InferSelectModel<typeof companyContactRelationships>;` beside `Company`/`Contact`.

Rationale to carry into comments: a **data-carrying** junction (it holds `description`), so it follows the FK/index halves of the ADR 0016 junction convention like `projectRoles` (`src/lib/db/projects-schema.ts:94`) while keeping the `unique()` pair for set semantics. Both FKs `cascade` — a link is meaningless without both endpoints — deliberately unlike `contacts.companyId`'s `set null`. Full `updatedAt` because the row is editable (unlike the pure junctions, which carry `createdAt` only). Name the unique constraint explicitly so `isUniqueViolation(error, "company_contact_relationships_unique")` can key off it.

Then `bun run db:generate` → inspect the SQL (constraint name must match the string used in the action) → `bun run db:migrate`.

## 3. Picker pre-filtering

**`src/actions/shared/entitySearch.ts`** — give `searchCompaniesByName` an optional `excludeId`, mirroring `searchStaffByName`'s existing `{ excludeId }` option exactly:

```ts
export async function searchCompaniesByName(
  query: string,
  { excludeId }: { excludeId?: string } = {},
) { … excludeId ? ne(companies.id, excludeId) : undefined … }
```

Optional-with-default, so the projects company picker is unaffected.

**`src/actions/crm/searchCompanies.ts`** — extend the input schema with `excludeId: z.string().min(1).nullish()` and pass it through.

**`src/actions/crm/searchContacts.ts`** — add `excludeCompanyId: z.string().min(1).nullish()` beside the existing `companyId` scope:

```ts
// Exclude a company's own employees — the relationship picker on a company page
// only offers people who work elsewhere. `isNull` first: a bare
// `ne(companyId, x)` is NULL-unknown for employer-less contacts and would
// silently drop them.
excludeCompanyId
  ? or(isNull(contacts.companyId), ne(contacts.companyId, excludeCompanyId))
  : undefined,
```

Both gates stay `permission: { crm: ["edit"] }`. Note the `or` import is already there; add `isNull`, `ne`.

Already-related people/companies are *not* filtered out — the unique-violation error covers that and threading the existing id list into the picker isn't worth it.

## 4. Read layer

**`src/actions/crm/getCompanyDetail.ts`** — new exported type and a new collection in the existing `Promise.all`:

```ts
export type CompanyRelatedContact = {
  relationshipId: string;
  id: string;
  name: string;
  role: string | null;
  employerId: string | null;
  employerName: string | null;
  description: string;
};
```

```ts
db.select({
    relationshipId: companyContactRelationships.id,
    id: contacts.id,
    name: contactName,               // the module-level contactNameSql(contacts)
    role: contacts.role,
    employerId: contacts.companyId,
    employerName: companies.name,
    description: companyContactRelationships.description,
  })
  .from(companyContactRelationships)
  .innerJoin(contacts, eq(companyContactRelationships.contactId, contacts.id))
  // The related contact's *own* employer (optional) — by definition a different
  // company than the one being viewed, so no alias collision.
  .leftJoin(companies, eq(contacts.companyId, companies.id))
  .where(eq(companyContactRelationships.companyId, id))
  .orderBy(asc(contacts.lastName), asc(contacts.firstName)),
```

Surface as `relatedContacts` on `CompanyDetail`. Do **not** feed these ids into `openTasksByParent` — this is a directory of links, not a task surface.

**`src/actions/crm/getContactDetail.ts`** — mirror image:

```ts
export type ContactRelatedCompany = {
  relationshipId: string;
  id: string;
  name: string;
  isPartner: boolean;
  description: string;
};
```

Query joins `companies` on `companyContactRelationships.companyId`, filters on `contactId`, orders by `asc(companies.name)`; surfaced as `relatedCompanies` on `ContactDetail`. Both reads stay `cache()`-wrapped server-only functions with explicit column projection.

## 5. Actions — `src/actions/crm/`

**`companyContactRelationship.schema.ts`** (pure, client-importable — header comment saying so, per ADR 0035). Reuses `id` from `@/lib/schemas/id-schema` and `requiredText` from `@/lib/schemas/text-schema`:

- `RELATIONSHIP_DESCRIPTION_MAX_LENGTH = 120` (constants live with the schema, matching `NOTE_MAX_LENGTH` in `entries.schema.ts`).
- `createCompanyContactRelationshipSchema` = `{ companyId, contactId, description }` — description `requiredText(120, "Describe the relationship.")`.
- `updateCompanyContactRelationshipSchema` = `{ id, description }` — the two endpoints are immutable; re-point by deleting and re-adding (mirrors `updateEntrySchema`).
- `deleteCompanyContactRelationshipSchema` = `{ id }`.
- Each exports its `z.input<>` type.

**`revalidate.ts`** — add the two-sided helper. A link row renders on **both** detail pages, so every write must refresh both:

```ts
export function revalidateCompanyContactRelationship(
  companyId: string,
  contactId: string,
): void {
  revalidateCompany(companyId);
  revalidateContact(contactId);
}
```

**`createCompanyContactRelationship.ts`** — `secureActionClient.metadata({ action: "create-company-contact-relationship", permission: { crm: ["edit"] } })`. Body:
1. Look up the contact's `companyId`; missing → `UserSafeActionError("That contact no longer exists.")`; equal to `companyId` → `"That contact already works at this company — they're listed under Contacts."` This is a server-side backstop even though the pickers pre-filter (app-side rule, same posture as `assertValidManager` in `contactChecks.ts`).
2. `generateId("ccrel")`, insert, and map failures: `isUniqueViolation(error, "company_contact_relationships_unique")` → `"That relationship already exists — edit the existing one instead."`; `isForeignKeyViolation` → `"That company or contact no longer exists."`
3. `revalidateCompanyContactRelationship(companyId, contactId)`; return `{ id }`.

**`updateCompanyContactRelationship.ts`** / **`deleteCompanyContactRelationship.ts`** — same gate; `.returning({ companyId, contactId })` + `assertRowExists(rows, "relationship")` (`src/actions/shared/assertRowExists.ts`) to get the revalidation targets, exactly as `deleteEntry` does.

No shared descriptor module (unlike `entryMutations.ts`) — one table, not three families.

## 6. UI

### `src/components/form/suggest-input.tsx` (new)

There is no creatable combobox in the repo. `EntityCombobox` can't produce a value its search action didn't return, so a static "search suggestions" action wouldn't accept typed text. This is ~35 lines over the already-vendored `ui/combobox.tsx` primitives — no `shadcn add`, no new dependency:

```tsx
"use client";
/**
 * A free-text input with a suggestion dropdown: the typed value is always the
 * value (nothing constrains it to the list), and the list is a shortcut.
 * `value` drives BOTH `value` and `inputValue` so the two stay in lock-step —
 * Base UI resets the input to the selected value on close, and here they're the
 * same string, so a novel entry round-trips instead of snapping back.
 *
 * Distinct from `EntityCombobox` on purpose: that holds an `{id,name}` picked
 * from a server search. Built-in filtering stays ON — the items are local.
 */
export function SuggestInput({ id, value, onChange, suggestions, placeholder, invalid }: {…})
```

**Verify this in the browser before building on it** — it's the one genuine unknown. If Base UI's Combobox fights freeform entry on blur/Escape, fall back to a plain `<Input>` with a row of ghost-button suggestion chips beneath that set the field on click: zero primitive risk, same outcome. Do **not** vendor `@base-ui/react/autocomplete` by hand (violates the "don't hand-write `src/components/ui/**`" rule). Also check Enter inside the dialog form — `src/components/form/stop-bubbling-submit.ts` is the existing escape hatch if it double-fires.

### `src/components/crm/relationship-dialog.tsx` (new)

One dialog serving both sides — they differ only in which endpoint is fixed and which picker shows, the same "branch on `kind`" pattern as `InlineOwnerField` / `EntryLog`.

```tsx
type Props = {
  side: "company" | "contact";      // which side the user is on = the fixed endpoint
  anchorId: string;                 // that endpoint's id
  existing: { id: string; targetName: string; description: string } | null;
  trigger?: ReactElement;                                   // add flow
  open?: boolean; onOpenChange?: (o: boolean) => void;      // edit flow (row pencil)
};
```

- Built on `FormDialog` + `FormDialogFooter` (`src/components/form/form-dialog.tsx`) — trigger + render-prop `({ close })`, remount-on-open already handled, controlled mode already supported for the edit flow.
- **Loose binding** (`.claude/rules/forms.md` case b): `useForm<{ target: EntityOption | null; description: string }>` + `useAction(create…)` / `useAction(update…)`, because the form holds an `EntityOption` while the action wants `companyId`/`contactId`. Validate `target` presence with `setError` in `onSubmit` and surface field errors via `applyServerIssues` (`src/components/form/apply-server-issues.ts`) — exactly what `ProjectRoleDialog` does, the closest precedent for one dialog covering create + edit.
- Target field, add flow:
  - `side === "company"` → `EntityCombobox` + `searchContacts` inside a `FormField label="Contact"`, with `searchArgs={useMemo(() => ({ excludeCompanyId: anchorId }), [anchorId])}` (`EntityCombobox` already supports `searchArgs` and requires referential stability). `labelAction` = "New contact" opening `CreateContactInlineDialog`.
  - `side === "contact"` → `EntityCombobox` + `searchCompanies` with `searchArgs={{ excludeId: employerCompanyId }}` (pass the contact's `companyId` in as a prop; `null` → no exclusion). `labelAction` = "New company" opening `CreateCompanyInlineDialog` — or just reuse `CompanyComboboxField` if it can forward `searchArgs`; check before duplicating it.
- Edit flow: render the target as a **disabled** `FormField` value (endpoints are immutable) so the dialog reads the same in both modes; only the description is editable.
- Description field: `FormField label="Relationship"` wrapping `SuggestInput` with `suggestions={RELATIONSHIP_DESCRIPTION_SUGGESTIONS}`, `placeholder="CSM"`.
- `onSuccess: close` is all that's needed — the actions revalidate both pages.

### `src/components/crm/related-contacts-section.tsx` (new, client)

`DetailSection title="Related contacts" count={rows.length}` with `action={canEdit ? <RelationshipDialog side="company" … trigger={<Button size="sm" variant="outline"><IconPlus/>Add relationship</Button>} /> : null}`.

Empty: `<TableEmpty>No related contacts yet — people who work elsewhere but touch this company.</TableEmpty>`
Table: `DetailTable headers={["Name", "Employer", "Relationship", …(canEdit ? [""] : [])]}` — name links `/contacts/${id}` with `role` as muted sub-text (matching the Contacts table directly above), employer links `/companies/${employerId}` or `<EmptyCell/>`, then a `w-0 text-right` actions cell: `IconButton` pencil (opens `RelationshipDialog` controlled with `existing`) and `IconButton` trash → `ConfirmDialog` (destructive, `loading={remove.isPending}`) → `deleteCompanyContactRelationship`. `IconButton` from `src/components/icon-button.tsx` requires a `label` — no bare icon buttons.

### `src/components/crm/related-companies-section.tsx` (new, client)

Same shape, `side="contact"`, headers `["Company", "Relationship", …]`; company cell links `/companies/${id}` with `<Badge variant="secondary">Partner</Badge>` when `isPartner`; empty state "No related companies yet — companies this person touches without working there." Kept as a separate component from the contacts one (their columns and links genuinely differ); only `RelationshipDialog` is shared — the same call the repo already makes for the referred-opportunities/referred-projects tables.

### Mount points

**`src/components/crm/company-detail-view.tsx`** — the Contacts tab gains a second section; add `className="flex flex-col gap-8"` to that `TabsContent` (matching the notes tab), keep the existing Contacts section unchanged, append `<RelatedContactsSection companyId={company.id} rows={company.relatedContacts} canEdit={canEdit} />`. Update the tab's doc-comment bullet.

**`src/components/crm/contact-detail-view.tsx`** — new tab, order **Activity | Companies | Opportunities** (people before pipeline, mirroring the company page's Notes | Contacts | Pipeline), rendering `<RelatedCompaniesSection contactId={contact.id} employerCompanyId={contact.companyId} rows={contact.relatedCompanies} canEdit={canEdit} />`. Update the component doc-comment, which currently says "two tabs".

No page-level changes: both `page.tsx` files already compute `canEdit = userHasPermission(user, { crm: ["edit"] })` and pass it in. No URL tab sync — nothing in the repo has it. The detail views stay Server Components; only the two new sections are `"use client"`.

## 7. Seed — `scripts/seed/`

- **`wipe.ts`** — add `"company_contact_relationships"` to `SEEDABLE_TABLES` in the `// crm` block, **above** `"contacts"`/`"companies"` (child → parent order, that file's contract).
- **`crm.ts`** — after the `contacts` insert, build ~25 rows: pick a random company + contact, `continue` when `contact.companyId === company.id` or the pair is already in a `Set`, description from `RELATIONSHIP_DESCRIPTION_SUGGESTIONS`, id `generateId("ccrel")`. Bias picks toward `isPartner` companies so the seed reads like the motivating case. Extend `CrmResult` with `relationships: number`.
- **`seed.ts`** — destructure and add `companyContactRelationships: relationships` to the `console.table` summary.

A stale seed is a `bun run check` failure, so this isn't optional.

## 8. Docs

Dispatch the **librarian** subagent (per AGENTS.md) with a summary covering:
- `docs/domains/crm.md` — the new entity, its FK/cascade shape, free-text description + suggestions module, the unique pair, the employer guard, and that `contacts.companyId` remains the sole employer. Note the contact page now has **three** tabs — the doc asserts two in several places.
- `docs/data-model.md` — a second *data-carrying* junction after `project_roles`; company↔contact now exists in two flavours (employer FK vs relationship row); suggestions-not-enum in the free-text section.
- `docs/ui.md` — `SuggestInput` vs `EntityCombobox`, when to use which.
- **New ADR** recording: a separate link table instead of multi-valued employment; free-text + suggestions as a reasoned departure from ADR 0016's tuple→pgEnum convention; unique-per-pair; the app-side employer guard (mirroring ADR 0022's manager rule); and the rule that any link write revalidates **both** detail pages. Register it in `docs/decisions/README.md`. Heads-up: `docs/decisions/` already contains **two** files numbered 0047 — don't add a third collision; flag the existing one for the librarian to clean up.

## 9. Order of work

1. Suggestions constant → 2. schema + `unique` import + row type → 3. `db:generate`, inspect SQL, `db:migrate` → 4. schema module + revalidate helper → 5. the three actions → 6. picker `excludeId`/`excludeCompanyId` plumbing → 7. read-layer additions → 8. **`SuggestInput`, verified in the browser** → 9. `relationship-dialog.tsx` → 10. the two section components → 11. mount in both detail views → 12. seed → 13. librarian docs pass.

## 10. Verification

- `bun run db:generate` produces exactly one new migration and no unrelated diffs; `bun run db:migrate`; `bun run db:seed --yes` (proves the seed isn't stale).
- `bun run check` (Biome + `tsc --noEmit` + `bun test`) and `bun run build`. The RBAC matrix test needs no change — the new actions reuse `crm.edit` — but it must still pass.
- Manual, as an admin/sales user (`bun run dev`):
  - Add a relationship from a company page → it appears on that company's Contacts tab **and** on the contact's new Companies tab without a manual reload (proves two-sided revalidation).
  - Edit the description from the contact side → the company side reflects it. Delete from either side.
  - Type a novel description ("Fractional CTO") → persists verbatim. Pick "CSM" from the dropdown → same.
  - Confirm the company-page picker omits that company's employees and still lists employer-less contacts (the NULL trap); confirm the contact-page picker omits their employer.
  - Add a duplicate pair → friendly error, not a crash.
  - Delete the contact → the link disappears from the company page (cascade).
  - View both pages as a role **without** `crm.edit` → tables render; no Add button, no pencil, no trash.
- Then `/code-review` on the diff before merging.
