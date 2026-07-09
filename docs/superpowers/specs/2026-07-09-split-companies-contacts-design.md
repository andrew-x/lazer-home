# Design: Split Companies/Contacts pages + Contact LinkedIn + Manager

**Date:** 2026-07-09
**Status:** approved, implementing

## Goal

Three changes to the CRM:

1. Split the combined `/companies` ("Companies & Contacts") page into two separate
   pages — `/companies` and `/contacts`.
2. Add an optional **LinkedIn** URL to contacts.
3. Add a **manager** relationship: a contact can be managed by another contact.

## Decisions (confirmed with user)

- **Create-only.** No edit flow exists for contacts yet; both new fields go on the
  existing create-contact dialog. We do not build an edit flow in this change.
- **Manager scope = same company only.** The manager picker only surfaces contacts
  sharing the new contact's selected company; enforced server-side too, not just UI.
- **LinkedIn = generic optional URL.** Reuse `optionalUrl` (same validator as company
  `websiteUrl`); no LinkedIn-specific validation.

**Accepted consequence:** a contact created without a company can't be given a
manager, and a manager can't be reassigned later (no edit). This is the natural
result of create-only + same-company-only and is deliberate.

## Data model — `src/lib/db/crm-schema.ts`

Two new nullable columns on `contacts`:

- `linkedinUrl` — `text`, nullable.
- `managerId` — `text`, nullable, self-referential FK → `contacts.id`,
  `onDelete: "set null"` (deleting a manager clears reports' `managerId`, matching
  the existing optional-FK convention on `companyId`).

Then `bun run db:generate` → `bun run db:migrate`.

## Validation — `createContact.schema.ts`

- `linkedinUrl` → `optionalUrl` (from `@/lib/url-schema`).
- `managerId` → `z.string().min(1).nullable().default(null)` (mirrors `companyId`).

## Reads & actions — `src/actions/crm/`

- **`getContactsPage.ts`** — extend `ContactRow` with `linkedinUrl`, `managerId`, and
  `managerName`. Resolve `managerName` via a self-join on `contacts` (drizzle
  `alias`), left-joined (manager optional).
- **`createContact.ts`** — insert `linkedinUrl` + `managerId`. **Integrity guard:**
  if `managerId` is set, verify the manager contact exists and shares the same
  non-null `companyId`; otherwise `UserSafeActionError`. Change
  `revalidatePath("/companies")` → `revalidatePath("/contacts")`.
- **`searchContacts.ts`** — accept an optional `companyId` in the input; when present,
  filter results to that company. (Optional field → existing `{ query }` callers are
  unaffected.)

## UI

### Page split (mirrors the Projects single-entity page pattern)

- **New `src/app/(app)/contacts/page.tsx`** — one-section contacts table page; title
  "Contacts"; `getContactsPage(parsePage(params.contactsPage))`;
  `PaginationControls basePath="/contacts" paramKey="contactsPage"`; `canEdit` gates
  `AddContactDialog`.
- **`src/app/(app)/companies/page.tsx`** — drop the contacts section; title →
  "Companies"; fetch only `getCompaniesPage`.
- **`src/components/app-shell/nav.ts`** — rename the existing entry to "Companies";
  add a "Contacts" entry (`/contacts`, `IconAddressBook`).

### Components — `src/components/crm/`

- **`manager-combobox-field.tsx`** (new) — a company-scoped single-select manager
  picker built on the Base UI Combobox (modeled on `EntityCombobox`), searching
  `searchContacts` with the selected `companyId`. **Disabled until a company is
  chosen**, with a hint. Reports `{ id, name } | null`.
- **`add-contact-dialog.tsx`** — add a LinkedIn URL input and the manager combobox.
  When the company changes, clear any selected manager (it may no longer be valid).
- **`contacts-table.tsx`** — add a **LinkedIn** column (external link, `IconBrandLinkedin`)
  and a **Manager** column (manager's name, or —).

## Permissions

Unchanged. Both entities remain behind the single `crm.edit` capability; reads stay
open to any signed-in user. `canEdit` gate stays on each page's Add dialog.

## Docs

Dispatch the `librarian` after implementation to reconcile `docs/domains/crm.md`,
`docs/ui.md`, and the data model.

## Out of scope

Edit/delete flows, reassigning managers, org-chart visualisation, cycle handling
beyond what create-only naturally prevents.
