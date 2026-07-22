# 0035 — Schema modules chosen by import boundary (drizzle-zod server-only, hand-written `z.object` for client-imported)

**Status:** accepted · 2026-07-20

## Context

Every mutation validates its input with a zod `inputSchema`, kept in its own
`*.schema.ts` module so the server action and the form's resolver share one
shape ([ADR 0004](./0004-action-layer.md)). Two ways to author these schemas
coexisted:

- **drizzle-zod** — `createInsertSchema(table)` / `createUpdateSchema(table)`,
  which derives the shape from the Drizzle table so the DB stays the source of
  truth for which columns exist.
- **hand-written `z.object({...})`** — spelled out from shared primitives.

drizzle-zod is the tidier choice *until the schema is imported by a client
component*. A form resolver (or a shared fields fragment, or a dialog)
importing a `createInsertSchema(table)` module pulls the **Drizzle table and
`drizzle-orm` into the client bundle** — dead weight the browser never needs,
and a foot-gun that grows silently as more forms reuse a schema. The
`'use server'` action boundary does **not** leak this way (it's a network call,
so a client importing an action does not import the action's transitive deps) —
only a **schema-module** import (direct, or schema→schema) makes a schema
client-reachable.

## Decision

**Pick the schema style by import boundary**, not by preference:

- **Imported by any `"use client"` component** (directly, or transitively via a
  shared fields fragment / another schema) → it **must be drizzle-free,
  hand-written `z.object(...)`**, built from the shared primitives
  (`@/lib/schemas/id-schema`, `@/lib/schemas/text-schema`, `@/lib/schemas/url-schema`) and the pure enum
  tuples/label maps (`@/lib/crm/line-of-business`, `@/lib/staff/staff-enums`, …). It carries
  a header comment marking it "a pure, client-importable module (no `db`/drizzle)".
- **Used only server-side** (the action file and other server modules) → it **may**
  keep drizzle-zod, so the table stays the source of truth for its columns.

The rule is documented in `.claude/rules/server-actions.md` and mirrored in
`src/actions/AGENTS.md` (the Codex runtime); see the runtime-parity note in
`AGENTS.md`. Several CRM / staff / admin schemas that back forms were migrated to
hand-written `z.object` accordingly. Server-only owner/skills writes
(`updateCompanyOwner`, `updateContactOwner`, `updateStaffSkills` — imported only
by their action files) legitimately stay on drizzle-zod.

## Consequences

- **Client bundles stay drizzle-free** — no table or `drizzle-orm` shipped to the
  browser through a form resolver.
- **A shared-primitive layer is load-bearing** — `id-schema` / `text-schema` /
  `url-schema` and the pure enum modules keep the hand-written schemas DRY and
  consistent, so "hand-written" doesn't mean "re-spell every field."
- **Moving a schema across the boundary is a real change** — if a server-only
  schema later gets imported by a client component, it must be rewritten to
  `z.object`. Adding an import can therefore turn into a schema rewrite.
- The convention is enforced by review/rules, not a lint rule; a stray
  `createInsertSchema` in a client-reached schema won't fail `bun run check`.

## Alternatives considered

- **Uniform drizzle-zod everywhere** (table as the single source of truth).
  Rejected — leaks Drizzle into the client bundle for every form schema, the
  exact problem above; the DRY win isn't worth shipping the ORM to the browser.
- **Uniform hand-written `z.object` everywhere.** Rejected — server-only schemas
  gain nothing from dropping drizzle-zod and lose the table-as-source-of-truth
  guard on which columns exist. The boundary is the honest dividing line.
