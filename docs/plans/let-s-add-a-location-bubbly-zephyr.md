# Add a `location` field to contacts, companies, and staff

## Context

We want to capture where a contact, company, and staff member is based. Location
is stored as a simple free-text string in the canonical form **`"City, CC"`**
(e.g. `"Toronto, CA"`) — not a foreign key, not a pgEnum. The valid values are
drawn from a **static world-cities dataset** shipped as JSON. The backend loads
that dataset and exposes a type-ahead **search action** that feeds a combobox, so
users pick a real city rather than typing free text.

Scope decisions (confirmed with the user):
- The `location` column is added to **contacts, companies, and staff**.
- **Editable UI** is added for **contacts and companies only**, as an **inline
  edit-in-place** control in the detail-view sidebar (mirroring `InlineOwnerField`).
  Staff gets the column + seed data but **no UI** this pass.
- The real cities JSON will be **dropped in by the user later**. For now we commit
  a **small US/CA sample file** at the target path so search/seed work in dev.
- Test/seed data focuses on **US and Canada** cities.

The dataset is column-oriented:
```
{ count, label[], city[], city_alt[], country[], country_code[], lat[], lng[] }
// label[i] === "city_ascii, iso2", e.g. "Tokyo, JP"
```

## Findings that shape the approach

- **Schema** lives in `src/lib/db/` per domain, barrelled by `schema.ts`; camelCase
  keys auto-map to snake_case columns. Existing nullable free-text columns to mirror:
  `contacts.role`, `companies.websiteUrl`, `staff.portfolioUrl` — all `text()`.
- **`resolveJsonModule: true`** is set (`tsconfig.json`), so the JSON can be
  `import`ed directly — no `fs`. Parsed once at module load = a natural singleton.
- **Search-action pattern** is exactly our use case: `src/actions/crm/searchCompanies.ts`
  (thin `'use server'` → `secureActionClient` + `searchQuerySchema` → returns
  `{ id, name }[]`). The `SearchAction` contract and `SEARCH_LIMIT = 10` live in
  `src/lib/core/search.ts`. `EntityCombobox` (`src/components/form/entity-combobox.tsx`)
  consumes a `SearchAction` with 250ms debounce — reuse it unchanged.
- **Inline edit** template: `src/components/crm/inline-owner-field.tsx` uses
  `InlineEditField` + `EntityCombobox` + a one-field update action
  (`updateContactOwner` / `updateCompanyOwner`) that `revalidatePath`s. We clone this.
- No existing static-data file, no fuzzy-search lib — plain lowercase substring
  match capped at `SEARCH_LIMIT` is the right, dependency-free fit.

## Implementation

### 1. Cities data + loader — `src/lib/cities/`

- **`src/lib/cities/world-cities.json`** — small **US/CA sample** (~30–50 rows) in the
  exact column-oriented structure above. The user replaces this with the full dataset
  later; the loader is size-agnostic. Ensure it contains US **and** CA rows (seed
  depends on it).
- **`src/lib/cities/cities.ts`** — pure helper module (a "pure compute helper an
  action delegates to", allowed in `src/lib`). **Do not** add `import "server-only"`
  here — the seed script (plain Bun) imports it, and `server-only` throws outside a
  React-server build. Add a header comment: _import only from the search action or
  seed, never a client component (would bundle the whole dataset to the client)._
  - `import worldCities from "./world-cities.json"` cast to a `CityColumns` type.
  - Build a row-oriented, **pre-lowercased** index array once at module scope
    (`{ label, countryCode, haystack }`, `haystack` = `city + city_alt + label`
    lowercased).
  - `searchCities(query): { id, name }[]` — trim + lowercase; blank → `[]`; substring
    match on `haystack`; `id` and `name` both = `label`; cap at `SEARCH_LIMIT`.
  - `cityLabelsForCountries(codes: string[]): string[]` — seed helper returning labels
    filtered to the given ISO2 codes.

### 2. Search action — `src/actions/cities/searchCities.ts`

Thin `'use server'` action mirroring `searchCompanies.ts`:
```ts
export const searchCities = secureActionClient
  .metadata({ action: "search-cities" }) // auth-only; see comment below
  .inputSchema(searchQuerySchema)
  .action(({ parsedInput: { query } }) => searchCitiesData(query));
```
**RBAC:** auth-gated via `secureActionClient` (must be logged in) but **intentionally
no capability gate** — it exposes only a static, public, non-sensitive city list,
never user data. Add an explicit justifying comment (per the permissions rule; same
spirit as `searchCompanies`'s comment, minus the capability).

### 3. Schema + migration

- Add `location: text()` (nullable, no default) to:
  - `companies` and `contacts` in `src/lib/db/crm-schema.ts`
  - `staff` in `src/lib/db/staff-schema.ts`
- `bun run db:generate` → `bun run db:migrate` (adds the next `drizzle/000N_*.sql`;
  `0001_*` adding `contacts.relationship_strength` is the single-column precedent).
- No pgEnum, no shared-enum module — it's free text validated only by the picker.

### 4. Inline edit UI (contacts + companies)

- **`src/components/crm/inline-location-field.tsx`** — clone of `inline-owner-field.tsx`:
  `InlineEditField` → `EntityCombobox` with `searchAction={searchCities}` and a
  `"Search a city…"` placeholder. Seed the `EntityOption | null` from the stored
  `location` string (`location ? { id: location, name: location } : null`); on confirm,
  pass the selected `label` (or `null` when cleared) to the update action.
- **Update actions** (mirror `updateContactOwner` / `updateCompanyOwner`):
  - `src/actions/crm/updateContactLocation.ts` + `updateContactLocation.schema.ts`
  - `src/actions/crm/updateCompanyLocation.ts` + `updateCompanyLocation.schema.ts`
  - Input: `{ id, location: string | null }` (hand-written `z.object`, client-importable
    boundary). Gate `permission: { crm: ["edit"] }` (same as the owner actions).
    `revalidatePath` the detail route after the update.
- Wire the new field into the detail sidebars:
  `src/components/crm/contact-detail-view.tsx` and `company-detail-view.tsx`
  (render as another sidebar field, read-only text + pencil, like the owner field).
- **Not touched:** `contactFields`/`companyFields`, `createContact`/`updateContact`
  schemas — the nullable column and dedicated one-field actions keep the create/edit
  dialogs untouched.

### 5. Seed (US/CA focus)

- Import `cityLabelsForCountries` from `@/lib/cities/cities`; compute
  `const usCaCities = cityLabelsForCountries(["US", "CA"])` once.
- `scripts/seed/crm.ts` — companies and contacts:
  `location: chance(0.8) ? faker.helpers.arrayElement(usCaCities) : null`.
- `scripts/seed/staff.ts` — staff (`buildStaff`): same pattern, e.g. `chance(0.9)`.
- Deterministic under the fixed faker seed. (Guard against an empty list only if the
  sample could lack US/CA rows — our sample won't.)

### 6. Docs

Dispatch the **librarian** subagent after implementation: add `location` to the
contacts/companies/staff entities in `docs/data-model.md` and the CRM domain doc,
and note the new `src/lib/cities` dataset + `searchCities` action (public reference
data, auth-only).

## Files

**New:** `src/lib/cities/world-cities.json`, `src/lib/cities/cities.ts`,
`src/actions/cities/searchCities.ts`, `src/components/crm/inline-location-field.tsx`,
`src/actions/crm/updateContactLocation.ts` (+ `.schema.ts`),
`src/actions/crm/updateCompanyLocation.ts` (+ `.schema.ts`).

**Modified:** `src/lib/db/crm-schema.ts`, `src/lib/db/staff-schema.ts`,
`src/components/crm/contact-detail-view.tsx`, `src/components/crm/company-detail-view.tsx`,
`scripts/seed/crm.ts`, `scripts/seed/staff.ts`, plus the generated `drizzle/000N_*.sql`.

## Verification

1. `bun run db:generate && bun run db:migrate` — column added cleanly.
2. `bun run db:seed` — reseeds with US/CA locations; no throw on empty arrayElement.
3. `bun run check` — Biome + `tsc` + tests (the seed compiling against the new columns
   is the drift guard) must be green.
4. `bun run dev` — open a contact and a company detail page: the location field shows,
   the pencil opens the combobox, typing a city filters via the server action,
   selecting persists and re-renders (revalidated), clearing sets it null.
5. `bun run build` — production build / type-check passes.
6. (Optional) drop in the full cities JSON at the same path and re-verify search — the
   loader must handle the larger file without code changes.
