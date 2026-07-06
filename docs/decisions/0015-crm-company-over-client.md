# 0015 — CRM org entity is "Company" (with an `isPartner` flag), not "Client"

**Status:** accepted · 2026-06-22

## Context

The data-model spine ([data-model.md](../data-model.md)) and the CRM domain doc originally named the CRM organisation entity **"Client"** — a customer we sell to. But a consultancy deals with more than customers: it also has **partners** (referral, delivery, tech partners) it tracks the same way — name, website, contacts attached — without them being clients. Building the first concrete CRM table forced the question: one entity or two, and what do we call it?

## Decision

Model a single **`companies`** table for every organisation we deal with, with a boolean **`isPartner`** (default `false`) marking partners. The entity is named **Company**, not Client. `isPartner` is a **standalone flag**, not a client-vs-partner dichotomy: a company may be a client, a partner, both, or neither — nothing requires it to be either.

- One table, not separate `clients` / `partners`: they share every field and contacts attach to any of them; a flag is cheaper than two near-identical tables and a polymorphic contact FK.
- `contacts.companyId` is a nullable FK with `onDelete: set null` — a contact can exist without a company, and removing a company orphans rather than deletes its contacts.

## Consequences

- **Terminology shift across the docs.** Wherever the spine said "Client" for the CRM org, it now says **Company** (the proposed Project/Opportunity entities still describe their link as "for a Company"). Future Project/Opportunity work links to `companies`; note there is **no `isClient` flag** — "client" is not modelled today, so don't assume `isPartner = false` means "client" (it just means "not flagged as a partner").
- `isPartner` is the only company classification today — no separate partner attributes, and no client flag. If partners grow their own fields, or a real client/prospect distinction is needed, revisit whether to add flags or promote to a richer type/enum.
- The narrower word "client" still appears elsewhere in the system for unrelated concepts (e.g. `staff.clientIntro`); don't conflate them.

## Alternatives considered

- **Keep "Client" and ignore partners for now** — rejected: partners are a real, known entity we'd have to retrofit, and renaming a shipped table/route is costlier than choosing the broader noun up front.
- **Separate `clients` and `partners` tables** — rejected: identical shape, and contacts would need a polymorphic or dual FK. The flag keeps reads and the contact relationship simple.
- **An enum `kind` (client | partner | …)** instead of a boolean — reasonable, but a boolean is enough for the one attribute we track today (is-a-partner); promote to an enum if a real client/prospect/partner classification is needed.
</content>
