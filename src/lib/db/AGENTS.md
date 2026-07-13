<!--
Codex nested AGENTS.md — mirrors .claude/rules/database.md (Claude Code loads that
rule by path glob; Codex loads this file when your cwd is at/under src/lib/db).
Deliberate duplication — keep in sync with the rule; /audit-agents checks parity.
-->

# Database (Drizzle + Postgres)

The Drizzle client is a hot-reload-safe singleton in `src/lib/db/db.ts`. Import `db` from there; never construct a new client.

**`db` is imported only from `src/actions/**`.** Pages and components (even SSR Server Components) go through the actions layer, never query Drizzle directly — see `src/actions/AGENTS.md` ("The actions layer is the entry point for DB access").

## Rules

- **Casing:** `casing: "snake_case"` is set in BOTH `src/lib/db/db.ts` and `drizzle.config.ts` — they must agree. Write camelCase keys; omit explicit column names and let Drizzle derive snake_case.
- **IDs:** app-generated CUID2 with a prefix via `generateId("thing")` (`src/lib/db/ids.ts`), minted before insert. Not DB sequences.
- **FKs:** `references(() => Other.id, { onDelete: "cascade" })` (choose the right onDelete).
- **Timestamps:** `timestamp().defaultNow().notNull()`; for updates add `.$onUpdate(() => new Date())`.
- **Dates & times are timezone-agnostic.** Never use timezone-aware column types. For calendar dates (join/termination, effective-from, PTO spans) use `date()` in its default **string** mode — it stores/returns `"YYYY-MM-DD"` with no zone; do NOT use `date({ mode: "date" })` (that yields JS `Date`s with offset pitfalls). For instants use plain `timestamp()` (Postgres `timestamp` *without* time zone), never `timestamp({ withTimezone: true })` / `timestamptz`. Treat all stored datetimes as wall-clock values; do any zone conversion at the edges (UI), not in the DB.
- **Types:** `InferSelectModel<typeof Table>` / `InferInsertModel`. Do NOT use `Table.$inferSelect`.
- **Auth tables** (`user`, `session`, `account`, `verification`) live in `auth-schema.ts` and participate in our migrations. Regenerate them with `bun run auth:generate` after changing auth config/plugins — don't hand-edit unless deliberate.

## Querying

- **Always project explicit columns — never select all.** Name the columns you need:
  - Query API: `db.query.thing.findMany({ columns: { id: true, name: true } })`.
  - Select builder: `db.select({ id: Thing.id, name: Thing.name }).from(Thing)` — not bare `db.select().from(Thing)`.
  - This keeps payloads minimal, avoids leaking columns (e.g. soft-deleted/internal fields) by accident, and means adding a column doesn't silently change every read. If you genuinely need every column, do it explicitly and say why.

## Migrations

- Edit schema → `bun run db:generate` (writes SQL to `./drizzle`) → `bun run db:migrate`.
- `bun run db:push` for quick dev iteration; `bun run db:studio` to browse.
- Dev runs against a **remote** Postgres (no local DB / Docker) — point `DATABASE_URL` at it (see `.env.example`).
