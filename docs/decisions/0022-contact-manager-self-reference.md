# 0022 — Contact "managed by": self-referential FK, same-company invariant enforced app-side

**Status:** **superseded** by [ADR 0052](./0052-contact-relationships-one-typed-junction.md) (2026-07-29) · originally accepted 2026-07-09

> **`contacts.managerId` no longer exists.** Management is now one `kind` of row in the
> unified **`contact_relationships`** junction (`reports_to`), alongside `succeeds` and
> `related` — see [ADR 0052](./0052-contact-relationships-one-typed-junction.md). What
> survives from this ADR: the **same-company rule for a manager** (still app-level, now in
> `contactRelationshipChecks.ts`) and the stance that a picker is an affordance, never the
> boundary. What's gone: the column, its `set null`, `assertValidManager`, and
> `ManagerComboboxField`. Read below only for the *why* of the original shape.

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

- ~~**Create-only limits the feature.**~~ **Obsolete:** contacts gained an edit flow
  (`edit-contact-dialog.tsx` + `updateContact`) well before this ADR was superseded, and
  `assertValidManager` grew a `selfId` guard for it. Relationships have since moved off the
  form entirely ([ADR 0052](./0052-contact-relationships-one-typed-junction.md)).
- **Changing a contact's company must revalidate the manager link** — a manager valid at the
  old company is invalid at the new one. Still true, and now handled properly:
  `updateContact` **deletes** the `reports_to` row when `companyId` changes (ADR 0052),
  where the old form merely reset its picker.
- ~~`getContactsPage` resolves `managerName` via a self-join~~ — **this was never true.**
  The contacts *list* read has never selected a manager at all (the detail read did, via a
  `contacts` `alias`, until ADR 0052 replaced it with the junction query). `ContactRow`
  gained `linkedinUrl` only, and that too has since moved to the detail read.
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
