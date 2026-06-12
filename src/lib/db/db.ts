import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/env";
import * as schema from "./schema";

/**
 * `casing: "snake_case"` lets us write camelCase keys in the schema and queries
 * while the DB uses snake_case columns. This MUST match `casing` in
 * drizzle.config.ts so generated migrations line up.
 */
function createDb() {
  const client = postgres(env.DATABASE_URL);
  return drizzle({ client, schema, casing: "snake_case" });
}

/**
 * Hot-reload-safe singleton: build the client once in production; in dev stash
 * it on globalThis so Next.js module reloading doesn't open a new connection
 * (and exhaust the pool) on every edit.
 */
const globalForDrizzle = globalThis as unknown as {
  db?: ReturnType<typeof createDb>;
};

function getDb() {
  if (env.NODE_ENV === "production") return createDb();
  if (!globalForDrizzle.db) globalForDrizzle.db = createDb();
  return globalForDrizzle.db;
}

export const db = getDb();
