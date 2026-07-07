# Domain: CRM

**Status: growing.** Companies, contacts, and opportunities (data, reads, create, and `/companies` + `/opportunities` UIs) all exist; the link from a *won* opportunity to a Project is still **proposed** (Project itself isn't built). Manages the companies and people we deal with (clients, partners, prospects) and the pipeline deals we're trying to win, all of which feed delivery.

## Purpose

Track who we sell to and work with, and (eventually) what we're trying to win, so won work flows cleanly into Projects and Allocations.

## Key entities

- **Company** (built) — an organisation we deal with. **`isPartner` is a standalone flag** marking whether the company is a partner (default `false`); it is **not** a client-vs-partner dichotomy — a company may be neither a client nor a partner, and nothing requires it to be either. We deliberately modelled this as *Company* rather than the narrower *Client* the early design assumed — see [ADR 0015](../decisions/0015-crm-company-over-client.md). Fields: `name` (required), `websiteUrl` (optional), `isPartner`. Table `companies`, id prefix `company`.
- **Contact** (built) — a person, optionally attached to a Company. Fields: `firstName`/`lastName` (required), `email` (required, **unique**), `phone` (optional; shown as a `tel:` link in the contacts table), `companyId` (optional FK → `companies`, `onDelete: set null`), `role` (optional free-text job title, e.g. "CTO"). Table `contacts`, id prefix `contact`. Schema in `src/lib/db/crm-schema.ts`; see [../data-model.md](../data-model.md).
- **Opportunity** (built) — a pipeline deal that always belongs to a Company. Fields: `name` (required), required `companyId` (FK → `companies`, **`onDelete: restrict`** — a company with live opportunities can't be deleted, unlike its optional/set-null contacts), `source` + `status` (pgEnums), optional free-text `nextSteps`. Table `opportunities`, id prefix `opp`. Its people are modelled with **four junction tables** (see below): related `contacts`, `owners` (→ `staff`), and referral sources split into `source_contacts` and `source_staff`. A *won* Opportunity will (proposed) produce a Project.
  - **`source`** (`opportunity_source`): `inbound`, `farming`, `extension`, `change_request`, `staff_referral`, `contact_referral`.
  - **`status`** (`opportunity_status`): `maturing`, `lead`, `qualifying`, `scoping`, `closing`, `closed_lost`, `closed_won`.
  - Both enum value tuples are declared **once** in `src/actions/crm/createOpportunity.schema.ts` (a pure, client-importable module — no `db`/drizzle) and imported by *both* the `pgEnum` in `crm-schema.ts` and the zod schema, so there's one source of truth. Display labels live in `src/components/crm/opportunity-display.ts`.

## What's built

- **Schema** — `src/lib/db/crm-schema.ts` (`companies`, `contacts`, `opportunities` + four junction tables), barrelled by `src/lib/db/schema.ts`. Migrations `drizzle/0012_spotty_mysterio.sql` (companies/contacts), `drizzle/0013_clean_firelord.sql` (adds `contacts.phone`), `drizzle/0014_nostalgic_crusher_hogan.sql` (opportunities + junctions + enums).
- **Junction tables** — the repo's **first** many-to-many join tables: `opportunity_contacts`, `opportunity_owners` (→ `staff`), `opportunity_source_contacts`, `opportunity_source_staff` (→ `staff`). All follow one convention (documented in [../data-model.md](../data-model.md#junction-tables--the-first-many-to-many-pattern)): a **surrogate `text` PK** via `generateId` (no composite PKs — repo convention), a **`unique(...)` on the FK pair** for set-semantics (no duplicate links), an **`index(...)` on the non-opportunity FK** for reverse lookups, and **both FKs `onDelete: "cascade"`** (a link is meaningless without both endpoints).
- **Server layer** — `src/actions/crm/`:
  - `getCompaniesPage.ts` / `getContactsPage.ts` / `getOpportunitiesPage.ts` — server-only reads (per ADR 0010), **server-side offset/limit pagination** with a `count` and a page clamped into range (out-of-bounds query params can't return an empty page). `PAGE_SIZE` is 20. Contacts left-join companies to resolve `companyName` (company is optional). Opportunities **inner**-join companies for `companyName` (company is required), and resolve owner names via a **single grouped follow-up query** over just this page's ids (no N+1).
  - `searchCompanies.ts` / `searchContacts.ts` / `searchStaff.ts` — type-ahead pickers, `secureActionClient` gated `crm.edit` (they back CRM entry, itself a write, so the gate stops them being used to enumerate the roster past the page gate). Each returns up to 10 `{ id, name }` by `ilike` match; **a blank query returns nothing** (search only runs once the user types). All share the LIKE-metacharacter escaper `escapeLike` in `src/lib/like.ts` (extracted from `searchCompanies`).
  - `createOpportunity.ts` — gated `crm.edit`. One **transaction**: inserts the opportunity then bulk-inserts junction rows, **deduping each id array** first so a repeat can't trip the junction `unique` index. Related entities (company, contacts) are created via their own actions first; this only consumes their ids. `revalidatePath("/opportunities")`.
  - `createOpportunity.schema.ts` — the shared zod schema (+ the enum tuples). A `superRefine` enforces the conditional referral rules: `source = staff_referral` ⇒ ≥1 `sourceStaffIds`; `source = contact_referral` ⇒ ≥1 `sourceContactIds`.
  - `createCompany.ts` — gated `crm.edit`.
  - `createContact.ts` — gated `crm.edit`; a **single `db.insert(contacts)`** (no transaction) that maps the Postgres unique-violation (SQLSTATE `23505`) on `email` to a user-safe "A contact with that email already exists." **Returns `{ id }`** (not `{ ok: true }`) so an inline-created contact can be immediately selected in the opportunity form. Creating a company inline from the contact form is **persist-first** — the new company is saved via `createCompany` first (through `CompanyComboboxField`'s inline dialog), then its id is passed here as `companyId`. This mirrors opportunities and replaced an earlier design where `createContact` created the company itself in a nested `db.transaction` (that `newCompany` path and the transaction are gone). Both company/contact mutations `revalidatePath("/companies")`. Input schemas live in sibling `.schema.ts` files.
- **UI** — `/companies` ("Companies & Contacts", `src/app/(app)/companies/page.tsx`) and `/opportunities` (`src/app/(app)/opportunities/page.tsx`), plus `src/components/crm/**` — see [../ui.md](../ui.md).

## Authorization

**Reads are open** — any signed-in user can browse all companies, contacts, and opportunities (the `(app)` gate is the boundary). **All CRM writes** are gated by a single flat capability (no ownership dimension): **`crm.edit`** (renamed from `contacts.edit` when opportunities landed), granted to `sales`, `manager`, `admin`. It covers creating/editing companies, contacts, *and* opportunities — including the inline company/contact creation and every type-ahead picker (`searchCompanies`/`searchContacts`/`searchStaff`) that backs entry. Declared in action metadata; each page hides its "Add" dialog(s) (via one `canEdit` flag) for users without the capability. See [domains/permissions.md](./permissions.md).

## Key flows

- **Pipeline management** (built) — create Opportunities and set their `status` through the pipeline (`maturing` → `lead` → … → `closed_won`/`closed_lost`). Create only today; status changes are set at creation (edit/progression UI is a follow-up).
- **Won → Project handoff** _(proposed)_ — winning an Opportunity (`status = closed_won`) will create the Project that delivery staffs and bills against. This is the seam between CRM and the rest of the system; keep the link explicit. Project isn't built yet.

## Connects to

- **Staff** — an opportunity's `owners` and referral `source_staff` are `staff` rows (FK, cascade). This is the first CRM ↔ staff link.
- **Allocations / Timesheets** via the Project a won Opportunity will create (proposed).
- See [../data-model.md](../data-model.md) and [../flows.md](../flows.md).

## Open questions

- Probability/weighting per status and pipeline revenue forecasting (value × probability) — not modelled; opportunities carry no monetary value field yet.
- **Edit/delete** — only create + read exist for all three entities (companies, contacts, opportunities). Note the `onDelete: restrict` on `opportunities.companyId` means a company-delete flow must handle live opportunities.
</content>
</invoke>
