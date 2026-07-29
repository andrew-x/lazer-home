# 0048 — Company ↔ contact relationships beyond employment: a separate link table, free-text description

**Status:** accepted · 2026-07-29

## Context

A contact's only link to a company was **`contacts.companyId`** — a single optional
**employer** FK ([ADR 0015](./0015-crm-company-over-client.md)). That models "where
does this person work?" and nothing else.

It can't express the case the team keeps hitting: a **partner company's CSM working
on one of our accounts**. Also an embedded FDE, a former employee who still opens
doors, an investor on a client's board. All of these are people who *relate to* a
company they don't work at, and the CRM had nowhere to put them — so they were
either absent or, worse, misfiled as employees of the company they merely serve.

Three shapes were available:

1. **Make employment multi-valued** — turn `companyId` into a junction. Rejected:
   it conflates two genuinely different facts, and every existing read that means
   "this person's employer" (the sidebar, the manager same-company rule, the
   contacts list's Company column, `searchContacts`' `companyId` scope) would have
   to pick a winner among several rows.
2. **Overload the existing junctions** (`opportunity_contacts` et al). Rejected:
   those hang off a *deal*, not a company; a partner CSM relationship outlives any
   one opportunity.
3. **A second, separate link table.** Chosen.

## Decision

Add **`company_contact_relationships`** (`src/lib/db/crm-schema.ts`, migration
`drizzle/0012_icy_excalibur.sql`) — one row per (company, contact) pair carrying a
short free-text **`description`** of how they relate. **`contacts.companyId` is
untouched and remains the sole employer link.**

### A data-carrying junction, with a named unique pair

It follows the FK/index halves of the junction convention
([ADR 0016](./0016-junction-table-and-shared-enum-conventions.md)) like
`project_roles` — surrogate `text` PK via `generateId("ccrel")`, an `index` on the
non-owning `contactId` for reverse lookups — and diverges on two points:

- **`unique(companyId, contactId)`, named explicitly.** One relationship per pair,
  so "edit the description" is unambiguous and a duplicate add can be answered with
  "edit the existing one instead". The constraint is *named* so
  `isUniqueViolation(error, "company_contact_relationships_unique")` can key off it.
  Chosen over allowing several labelled roles per pair because the migration cost is
  **asymmetric**: dropping the unique later is one line, while adding it later needs
  a data de-dupe.
- **Both FKs `cascade`, and a full `updatedAt`.** Cascade because the row's whole
  identity *is* the pair — deliberately unlike `contacts.companyId`'s `set null`,
  which is an optional *attribute* of a contact. `updatedAt` because the row is
  editable, unlike the pure junctions that are only inserted and deleted.

### Free text with suggestions — a deliberate departure from ADR 0016

`description` is **`text`, not a `pgEnum`**. ADR 0016's "declare the tuple once,
feed both `pgEnum` and `z.enum`" convention exists for **closed** sets; this set is
open-ended — the labels differ per client and shouldn't need a migration to grow.
`RELATIONSHIP_DESCRIPTION_SUGGESTIONS` (`src/lib/crm/company-contact-relationship.ts`,
pure + client-importable) offers **CSM, FDE, Partner manager, Former employee,
Investor** as *autocomplete hints only* — nothing validates against the list, so
"Fractional CTO" persists verbatim (capped at 120 chars). Same reasoning as the
free-text `location` label.

This required a new UI primitive: **`SuggestInput`**, the app's first
freeform-with-suggestions control. `EntityCombobox` structurally cannot produce a
value its search action didn't return, so a "static search" wouldn't accept typed
text. See [ui.md](../ui.md#suggestinput-vs-entitycombobox).

### Employment is never a relationship

`createCompanyContactRelationship` **rejects a contact whose `companyId` already is
the target company** — app-side, mirroring the manager rule's posture
([ADR 0022](./0022-contact-manager-self-reference.md)) rather than a DB trigger.
Both pickers also pre-filter (`searchContacts.excludeCompanyId`,
`searchCompanies.excludeId`), so the case is normally unreachable in the UI; the
server check is the backstop against a hand-crafted request.

**Reads are deliberately *not* filtered the same way.** If someone's employer later
changes *to* a company they had a relationship with, the now-redundant row stays
visible — and therefore deletable. Hiding it would create an undeletable ghost.

### Both sides are peers, so every write revalidates both

The row renders as "Related contacts" under the company page's **Contacts** tab and
as the contact page's new **Companies** tab, and add/edit/remove work identically
from either. Two consequences:

- One shared `RelationshipDialog` (a `side` prop picks which endpoint is fixed and
  therefore which entity the picker searches), rather than two near-identical dialogs.
- **`revalidateCompanyContactRelationship(companyId, contactId)` refreshes both
  detail pages on every write.** A one-sided revalidate would leave the other page
  showing a stale list — which is why `update`/`delete` `.returning()` the pair
  rather than taking it from client input.

**Endpoints are immutable once created.** The update action accepts only a new
description (mirroring `updateEntrySchema`, which likewise never re-parents an
entry), so the edit dialog shows the target as a disabled field and re-pointing a
relationship means remove + re-add. This keeps the unique pair and the
employer guard from needing a second enforcement path.

## Consequences

- **A company and a contact are now linked two ways**, and the distinction has to
  stay legible. The UI carries it by placing both readings in one tab on the company
  page with an **Employer** column on the relationship table, and by keeping the
  employer a sidebar `MetaField` on the contact page — never inside the Companies tab.
- **The contact detail page now has three tabs** (Activity · Companies ·
  Opportunities), matching the company page's count.
- Relationships are **not** surfaced on the list tables, the opportunity drawer, or
  as a filter — consistent with the lists staying lean. If "show me every partner
  contact on this account" becomes a real need, that's a follow-up.
- `searchCompaniesByName` gained an optional `excludeId` (mirroring
  `searchStaffByName`'s), so the projects company picker is unaffected.
- **A NULL trap is now load-bearing in `searchContacts`.** Excluding a company's
  employees must be `or(isNull(companyId), ne(companyId, excluded))` — a bare `ne`
  is NULL-unknown and silently drops every employer-less contact. Verified against
  the database in both directions.

## Notes

Implementing this surfaced an **unrelated pre-existing bug**, fixed here because the
duplicate-pair message depends on it: `isUniqueViolation` / `isForeignKeyViolation`
read `error.code`, but Drizzle wraps driver failures in a `DrizzleQueryError` and
hangs the real `PostgresError` off **`.cause`** — so both predicates had been
matching nothing, and the existing "A contact with that email already exists."
message never fired. Both now read through the shared `pgErrorFields`
(`src/lib/db/pg-error.ts`), which walks the cause chain; `src/lib/db/pg-error.test.ts`
pins the behaviour.
