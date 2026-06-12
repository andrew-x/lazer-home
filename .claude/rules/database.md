---
paths:
  - "src/lib/db/**"
  - "drizzle.config.ts"
---

# Database (Drizzle + Postgres)

The Drizzle client is a hot-reload-safe singleton in `src/lib/db/db.ts`. Import `db` from there; never construct a new client.

## Rules

- **Casing:** `casing: "snake_case"` is set in BOTH `src/lib/db/db.ts` and `drizzle.config.ts` — they must agree. Write camelCase keys; omit explicit column names and let Drizzle derive snake_case.
- **IDs:** app-generated CUID2 with a prefix via `generateId("thing")` (`src/lib/db/ids.ts`), minted before insert. Not DB sequences.
- **FKs:** `references(() => Other.id, { onDelete: "cascade" })` (choose the right onDelete).
- **Timestamps:** `timestamp().defaultNow().notNull()`; for updates add `.$onUpdate(() => new Date())`.
- **Types:** `InferSelectModel<typeof Table>` / `InferInsertModel`. Do NOT use `Table.$inferSelect`.
- **Auth tables** (`user`, `session`, `account`, `verification`) live in `auth-schema.ts` and participate in our migrations. Regenerate them with `bun run auth:generate` after changing auth config/plugins — don't hand-edit unless deliberate.

## Migrations

- Edit schema → `bun run db:generate` (writes SQL to `./drizzle`) → `bun run db:migrate`.
- `bun run db:push` for quick dev iteration; `bun run db:studio` to browse.
- Local DB: `docker compose up -d` (see docker-compose.yml).
