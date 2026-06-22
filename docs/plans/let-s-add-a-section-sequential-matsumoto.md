# Plan: Companies & Contacts (CRM foundation)

## Context

The PSA platform's CRM domain is documented (`docs/domains/crm.md`, `docs/data-model.md`) but unbuilt. This adds the first concrete CRM data: a **Companies** entity and a **Contacts** entity, plus a page to create and browse them. It's the seed for later CRM work (opportunities, pipeline, linking projects to clients).

Decisions confirmed with the user:
- **Naming:** use `companies` / `contacts` as requested (the docs currently call the org entity "Client" — `isPartner` makes companies broader than just clients). Docs will be reconciled by the librarian after the change.
- **RBAC:** `sales`, `manager`, and `admin` roles may create companies/contacts; everyone else is read-only.
- **Scope:** create (via dialog) + paginated read-only tables only. No edit/delete yet.

Notable requirements: company picker on the contact form is a **debounced, server-backed searchable list**; both tables use **server-side pagination** (large datasets expected).

## Data model

New file `src/lib/db/crm-schema.ts` (export from the barrel `src/lib/db/schema.ts`). Follow `staff-schema.ts` conventions: `text().primaryKey()` ids minted via `generateId(prefix)` (`src/lib/db/ids.ts`), camelCase columns (Drizzle derives snake_case), standard `createdAt`/`updatedAt` timestamps.

```ts
export const companies = pgTable("companies", {
  id: text().primaryKey(),                 // generateId("company")
  name: text().notNull(),
  websiteUrl: text(),                      // optional
  isPartner: boolean().notNull().default(false),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
});

export const contacts = pgTable("contacts", {
  id: text().primaryKey(),                 // generateId("contact")
  firstName: text().notNull(),
  lastName: text().notNull(),
  email: text().notNull().unique(),
  companyId: text().references(() => companies.id, { onDelete: "set null" }), // optional
  role: text(),                            // optional, e.g. "CTO"
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
});
```

Then `bun run db:generate` → `bun run db:migrate`.

## Permissions (`src/lib/permissions.ts`)

Add CRM resources to the `statement` and grant them to the right roles. Gate actions via `metadata.permission` (per `.claude/rules/server-actions.md`), never hand-written checks.

```ts
export const statement = {
  ...defaultStatements,
  staff: ["edit"],
  pto: ["review"],
  companies: ["create"],
  contacts: ["create"],
} as const;
```
Add `companies: ["create"], contacts: ["create"]` to the `sales`, `manager`, and `admin` roles. (`admin` already spreads `adminAc.statements`; add the explicit grants alongside its existing ones, matching how `manager` lists `staff`/`pto`.)

## Server layer (`src/actions/crm/`)

Reads = plain `server-only` functions; mutations = `secureActionClient` actions; schemas in sibling `.schema.ts` files (per `.claude/rules/server-actions.md`). Project explicit columns only (`.claude/rules/database.md`).

- **`getCompaniesPage.ts`** — `(page, pageSize=20)` → `{ rows, total, page, pageSize, pageCount }`. `db.select({id,name,websiteUrl,isPartner}).from(companies).orderBy(asc(companies.name)).limit(pageSize).offset(...)` + a `count()` query for `total`.
- **`getContactsPage.ts`** — same shape; `leftJoin(companies)` to project `companyName` (company is optional). Order by `asc(contacts.lastName)`.
- **`searchCompanies.ts`** — `secureActionClient` action (client-callable for the debounced picker). Input `{ query: string }`; returns up to ~10 `{id, name}` via `ilike(companies.name, %query%)`, ordered by name. Empty query → return first ~10. Used by the contact form's combobox.
- **`createCompany.ts`** (+`.schema.ts`) — `secureActionClient.metadata({ action: "create-company", permission: { companies: ["create"] } })`. Schema: `name` (min 1), `websiteUrl` (reuse the `optionalUrl` pattern from `updateStaffLinks.schema.ts` — `"" | url` → null), `isPartner` (boolean, default false). Mint id with `generateId("company")`, insert, `revalidatePath("/companies")`.
- **`createContact.ts`** (+`.schema.ts`) — `permission: { contacts: ["create"] }`. Schema: `firstName`/`lastName`/`email` required (`z.email()`), `companyId` optional (`z.string().min(1).nullish()`), `role` optional. Mint id with `generateId("contact")`. Catch unique-email violation → `throw new UserSafeActionError("A contact with that email already exists.")`. `revalidatePath("/companies")`.

## UI

**Component install:** `bunx --bun shadcn@latest add command` (Command/Combobox primitive isn't vendored yet; needed for the searchable company picker). Per `.claude/rules/ui.md`, add via the CLI — don't hand-write `components/ui`.

**Nav** (`src/components/app-shell/nav.ts`): add `{ title: "Companies", href: "/companies", icon: IconBuildingSkyscraper }` (Tabler icon) to `NAV_ITEMS`.

**Page** `src/app/(app)/companies/page.tsx` (Server Component, follows the `/staff` page template):
- `export const metadata = { title: "Companies & Contacts" }`.
- Reads `searchParams` for `companiesPage` and `contactsPage` (independent), calls `getCompaniesPage`/`getContactsPage`, fetches `getCurrentUser` and computes `canCreate = userHasPermission(user, { companies: ["create"] })` to conditionally render the "Add" buttons.
- Renders two sections, each: header + Add dialog trigger (when `canCreate`) + table + pagination controls.

**Components** (`src/components/crm/`):
- `companies-table.tsx`, `contacts-table.tsx` — server components rendering `Table` (`src/components/ui/table.tsx`). Contacts show company name (or "—"), website renders as a link, isPartner as a `Badge`.
- `pagination-controls.tsx` — Prev/Next as `<Link>`s (no client JS) built from the current `searchParams`, mutating only that table's page param while preserving the other. Show "Page X of N"; disable at bounds.
- `add-company-dialog.tsx` — `"use client"`, copies `edit-links-dialog.tsx`: `Dialog` + `useHookFormAction(createCompany, zodResolver(...))`, `formKey` remount on open, `Button loading={action.isPending}`, server error from `action.result.serverError`. Fields: `name` (Input), `websiteUrl` (Input type=url), `isPartner` (Switch). `onSuccess` closes dialog.
- `add-contact-dialog.tsx` — same shell. Fields: firstName, lastName, email Inputs; `role` Input; `companyId` via the company combobox below.
- `company-combobox.tsx` — `"use client"` searchable picker wired through RHF `Controller`. `Popover` + `Command`; debounce the search input with a new `src/hooks/useDebouncedValue.ts` (~250ms; no debounce hook exists today), feeding `useAction(searchCompanies)`; render results as `CommandItem`s; selecting sets `companyId` and shows the chosen name. Allow clearing (company is optional).

## Files

- New: `src/lib/db/crm-schema.ts`; `src/actions/crm/{getCompaniesPage,getContactsPage,searchCompanies,createCompany,createContact}.ts` (+ `.schema.ts` for the two creates); `src/app/(app)/companies/page.tsx`; `src/components/crm/*`; `src/hooks/useDebouncedValue.ts`; `src/components/ui/command.tsx` (via CLI); a generated migration in `drizzle/`.
- Edit: `src/lib/db/schema.ts` (barrel export), `src/lib/permissions.ts`, `src/components/app-shell/nav.ts`.

## Verification

1. `bun run db:generate` then `bun run db:migrate` — migration applies cleanly.
2. `bun run check` (Biome + tsc) and `bun run build` — both pass.
3. `bun run dev` and exercise `/companies`:
   - As a `sales`/`manager`/`admin` user: Add Company (with/without website, toggle partner) and Add Contact appear and persist; tables update.
   - Company combobox: typing filters server-side after debounce; selecting links the contact; contacts table shows the company name; leaving it blank creates a contact with no company.
   - Pagination: with >20 rows, Prev/Next move pages server-side and the two tables paginate independently (URL carries both params).
   - Duplicate contact email surfaces the friendly error.
   - As a plain `user`: tables are visible but Add buttons are hidden, and calling the create actions is rejected by RBAC.
4. `/audit-rbac` (or `/security-review`) clean for the new actions.
5. Dispatch the **librarian** subagent to reconcile `docs/domains/crm.md` + `docs/data-model.md` (Company vs Client terminology, the new tables) — automatic per AGENTS.md.
