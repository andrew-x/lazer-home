# 0022 — Contact "managed by": self-referential FK, same-company invariant enforced app-side

**Status:** accepted · 2026-07-09

## Context

Splitting companies and contacts onto separate pages ([design spec](../superpowers/specs/2026-07-09-split-companies-contacts-design.md))
came with two additions to `contacts`: a `linkedinUrl` and a "managed by" pointer
to another contact. The manager pointer is the repo's **first self-referential
relationship** (a contact → contact link) and its only real design questions were the
FK shape, where the "same company" business rule lives, and how it interacts with the
fact that contacts are still **create-only**.

The `linkedinUrl` half is unremarkable — a nullable `text` column validated by the
shared `optionalUrl` schema (same as company `websiteUrl`), shown as an external
"Profile" link. This ADR is about the manager link.

## Decision

Add a nullable **`managerId`** column to `contacts` (`src/lib/db/crm-schema.ts`), a
self-referential FK → `contacts.id` with **`onDelete: "set null"`**. Migration
`drizzle/0021_glamorous_goliath.sql`. Drizzle needs an explicit
`(): AnyPgColumn => contacts.id` reference callback to type the self-reference.

- **Self-referential single FK, `set null`.** Mirrors the optional-FK convention on
  `companyId`: removing a manager just clears their reports' pointer rather than
  deleting or blocking. No junction table — a contact has at most one manager.
- **Business rule: a manager must be an existing contact at the *same company*.**
  This is enforced in **two places, both application-level, not the DB**:
  1. **UI** — `ManagerComboboxField` is disabled until a company is chosen and passes
     the chosen `companyId` to `searchContacts` (which now takes an optional `companyId`
     filter), so the picker only offers colleagues.
  2. **Server** — `createContact` re-checks with a DB lookup: `managerId` requires a
     `companyId`, and the manager row's `companyId` must equal the new contact's. A
     hand-crafted request can't create a cross-company or dangling management link.
- **The invariant is NOT a DB constraint.** A FK can't express "same company as this
  row" cheaply; the app check is the source of truth (same stance as the
  project↔opportunity same-company invariant, [ADR 0019](./0019-project-opportunity-link.md)).

## Consequences

- **Create-only limits the feature.** Contacts have no edit flow, so `managerId` (and
  `linkedinUrl`) can only be set at creation. Concretely: a contact created **without**
  a company can never be given a manager, and a manager can't be reassigned or added
  later. Building the contact edit flow is the way to lift this — and that flow must
  carry the same-company re-check.
- **Changing a contact's company later (once edit exists) must revalidate `managerId`** —
  a manager valid at the old company may be invalid at the new one. The create form
  already resets the manager selection when the company changes; an edit form must do
  the same and the server must re-verify.
- `getContactsPage` resolves `managerName` via a **self-join** on `contacts` (drizzle
  `alias`), alongside the existing company left-join. `ContactRow` gained `linkedinUrl`,
  `managerId`, `managerName`.
- `searchContacts` grew an optional `companyId` filter param; it stays `crm.edit`-gated
  like the other pickers, so it can't be used to enumerate the roster past the page gate.

## Alternatives considered

- **DB-level same-company constraint** (composite FK / trigger / check). Rejected:
  disproportionate machinery for a rule the app already owns, and a plain FK can't
  reference another column's value. Consistent with ADR 0019's app-level stance.
- **A separate `contact_reports` junction / manager on a company-membership table.**
  Rejected: a contact has one manager, not many; a single nullable FK is simplest.
- **`onDelete: restrict` / `cascade` on `managerId`.** Rejected: `cascade` would delete
  a person's reports when their manager is removed (absurd); `restrict` would block
  deleting anyone who manages someone. `set null` — clear the pointer — is the only sane
  choice, matching `companyId`.
- **Enforcing the rule only in the UI.** Rejected: the picker is an affordance, not a
  boundary; the server must re-check (the standard action-layer stance).
