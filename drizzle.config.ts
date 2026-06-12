import { defineConfig } from "drizzle-kit";

// Bun auto-loads .env, so process.env.DATABASE_URL is available for db:* scripts.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL as string },
  // MUST match `casing` on the runtime Drizzle client (src/lib/db/db.ts).
  casing: "snake_case",
});
