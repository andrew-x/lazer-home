# Domain: CRM

**Status: first slice built.** Companies + contacts (data, reads, create, and a `/companies` UI) exist; the sales pipeline (Opportunity) and project links are still **proposed**. Manages the companies and people we deal with (clients, partners, prospects) that feed delivery.

## Purpose

Track who we sell to and work with, and (eventually) what we're trying to win, so won work flows cleanly into Projects and Allocations.

## Key entities

- **Company** (built) — an organisation we deal with. **`isPartner` is a standalone flag** marking whether the company is a partner (default `false`); it is **not** a client-vs-partner dichotomy — a company may be neither a client nor a partner, and nothing requires it to be either. We deliberately modelled this as *Company* rather than the narrower *Client* the early design assumed — see [ADR 0015](../decisions/0015-crm-company-over-client.md). Fields: `name` (required), `websiteUrl` (optional), `isPartner`. Table `companies`, id prefix `company`.
- **Contact** (built) — a person, optionally attached to a Company. Fields: `firstName`/`lastName` (required), `email` (required, **unique**), `phone` (optional; shown as a `tel:` link in the contacts table), `companyId` (optional FK → `companies`, `onDelete: set null`), `role` (optional free-text job title, e.g. "CTO"). Table `contacts`, id prefix `contact`. Schema in `src/lib/db/crm-schema.ts`; see [../data-model.md](../data-model.md).
- **Opportunity** _(proposed — not built)_ — a pipeline deal for a Company, moving through stages (e.g. lead → qualified → proposal → won/lost). A *won* Opportunity produces a Project.

## What's built

- **Schema** — `src/lib/db/crm-schema.ts` (`companies`, `contacts`), barrelled by `src/lib/db/schema.ts`. Migrations `drizzle/0012_spotty_mysterio.sql` (initial) and `drizzle/0013_clean_firelord.sql` (adds `contacts.phone`).
- **Server layer** — `src/actions/crm/`:
  - `getCompaniesPage.ts` / `getContactsPage.ts` — server-only reads (per ADR 0010), **server-side offset/limit pagination** with a `count` and a page clamped into range (out-of-bounds query params can't return an empty page). Contacts left-join companies to resolve `companyName` (company is optional). `PAGE_SIZE` is 20.
  - `searchCompanies.ts` — `secureActionClient`, gated `contacts.edit` (it's the type-ahead behind contact entry, which is itself a write). Debounced; returns up to 10 `{ id, name }` by `ilike` name match (empty query → first 10 alphabetically).
  - `createCompany.ts` — gated `contacts.edit`.
  - `createContact.ts` — gated `contacts.edit`; maps the Postgres unique-violation (SQLSTATE `23505`) on `email` to a user-safe "A contact with that email already exists." Both mutations `revalidatePath("/companies")`. Input schemas live in sibling `.schema.ts` files.
- **UI** — `/companies` ("Companies & Contacts", `src/app/(app)/companies/page.tsx`) and `src/components/crm/**` — see [../ui.md](../ui.md).

## Authorization

**Reads are open** — any signed-in user can browse all companies and contacts (the `(app)` gate is the boundary). **All CRM writes** are gated by a single flat capability (no ownership dimension): **`contacts.edit`**, granted to `sales`, `manager`, `admin`. It covers creating/editing both companies and contacts — including creating a company inline from the contact form, and the `searchCompanies` type-ahead that backs contact entry. Declared in action metadata; the page hides both "Add" dialogs (via one `canEdit` flag) for users without the capability. See [domains/permissions.md](./permissions.md).

## Key flows _(proposed)_

- **Pipeline management** — create and progress Opportunities through stages.
- **Won → Project handoff** — winning an Opportunity creates the Project that delivery staffs and bills against. This is the seam between CRM and the rest of the system; keep the link explicit.

## Connects to

- **Allocations / Timesheets** via the Project a won Opportunity will create (proposed).
- See [../data-model.md](../data-model.md) and [../flows.md](../flows.md).

## Open questions

- Pipeline stages and probability/weighting model — TBD.
- Do we forecast revenue from the pipeline (value × probability)?
- Edit/delete for companies and contacts (only create + read exist today).
</content>
</invoke>
