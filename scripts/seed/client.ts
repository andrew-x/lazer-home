import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";

/**
 * A standalone Drizzle client for the seed script.
 *
 * The app's `src/lib/db/db.ts` singleton is deliberately NOT reused here: it's a
 * hot-reload-safe long-lived connection owned by the Next.js server, and the repo
 * rule (`.claude/rules/database.md`) is that `db` is imported only from
 * `src/actions/**`. A one-off CLI needs to own its own connection so it can close
 * it and exit — so the seed constructs its own client from `DATABASE_URL`. This is
 * the documented exception to "never construct a new client".
 *
 * We read `process.env.DATABASE_URL` directly (not `@/env`) so the seed only needs
 * a database URL, not the full server env (Better Auth secret, etc.). Bun
 * auto-loads `.env`, so `bun run db:seed` picks it up with no extra setup.
 */
export type SeedDb = ReturnType<typeof createSeedDb>["db"];

export function createSeedDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — add it to .env (see .env.example) or the environment.",
    );
  }
  const client = postgres(url, { max: 1 });
  const db = drizzle({ client, schema, casing: "snake_case" });
  return { db, client, url };
}

/** A human-readable "host/database" label for the target, for the safety prompt. */
export function describeTarget(url: string): string {
  try {
    const { host, pathname } = new URL(url);
    return `${host}${pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

/** Heuristic guard: does this connection string look like a production database? */
export function looksProduction(url: string): boolean {
  return /prod/i.test(url);
}
