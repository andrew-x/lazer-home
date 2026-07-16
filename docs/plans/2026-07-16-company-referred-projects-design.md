# Design: "Referred projects" on the company detail page

**Date:** 2026-07-16
**Status:** approved (pending spec review)

## Goal

Add a section to the company detail page (`/companies/[id]`) listing projects that
grew out of an opportunity **referred by a contact who works at this company**.

## Why it's distinct from "Projects"

The existing "Projects" section lists projects owned by this company
(`projects.companyId = id`). Referred projects are keyed off the *referral
relationship*, not ownership: a contact at Company A can refer us into Company B, so
the resulting project belongs to Company B. These projects therefore often belong to
a **different** company than the one being viewed. The two sections answer different
questions ("what are we delivering for them" vs. "what did their people bring us"),
so they coexist; a self-referral (a contact here referring a deal for this same
company) can legitimately appear in both.

## Data path

Mirrors the per-contact derivation in `getContactDetail.referredProjects`, one level
up (all contacts at the company instead of a single contact):

```
opportunitySourceContacts
  → contacts        (contacts.companyId = <this company>)   -- referrers at this company
  → opportunities   (sourceContact.opportunityId)
  → projects        (projects.opportunityId)                -- the delivered project
  → companies       (projects.companyId)                    -- the CLIENT company
```

## Read layer — `src/actions/crm/getCompanyDetail.ts`

- Add type:
  ```ts
  export type CompanyReferredProject = {
    id: string;                    // project id
    name: string;                  // project name
    clientCompanyId: string;       // company the project is FOR (may differ from this company)
    clientCompanyName: string;
    referrers: { id: string; name: string }[]; // referring contact(s) at THIS company
  };
  ```
- Add `referredProjects: CompanyReferredProject[]` to `CompanyDetail`.
- Add a query to the existing `Promise.all` that selects one row per
  (project, referring contact), joining
  `opportunitySourceContacts → contacts (companyId = id) → opportunities → projects →
  companies`, ordered by `asc(projects.name)`.
- **Group in code** by project id (preserving name order), collecting distinct
  referrers into the `referrers` array — so the view renders one row per project even
  when a deal had multiple source contacts at this company. Referring-contact name is
  built with the same `firstName || ' ' || lastName` `contactName` expression already
  in the file.
- No permission change: CRM reads stay open under the `(app)` gate, consistent with
  the rest of `getCompanyDetail`.

## View layer — `src/components/crm/company-detail-view.tsx`

- New `<DetailSection title="Referred projects" count={company.referredProjects.length}>`
  placed **immediately after the "Opportunities" section**, before "Projects".
- Table columns (following the existing section table pattern):
  - **Project** — plain text (projects have no detail page, matching the existing
    "Projects" section).
  - **Client** — `InternalLink` → `/companies/[clientCompanyId]`.
  - **Referred by** — the `referrers`, each an `InternalLink` → `/contacts/[id]`,
    separated by ", " when there is more than one.
- Empty state (`<TableEmpty>`): *"No projects referred by contacts at this company yet."*

## Out of scope / not touched

- No schema change, no migration.
- No new action; no mutation (read-only feature).
- No permission change.
- The contact detail page's existing `referredProjects` section is unchanged.

## Follow-up

- After merge, dispatch the `librarian` subagent to reconcile `docs/domains/crm.md`
  (the `getCompanyDetail` collection list and the company detail-page section list).
- Run `bun run check` (and `bun run build`) before claiming done.
