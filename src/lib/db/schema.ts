import type { InferSelectModel } from "drizzle-orm";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

// Re-export the Better Auth tables so the whole schema is reachable from one
// import (`import * as schema from "@/lib/db/schema"`).
export * from "./auth-schema";

/**
 * Example app table — a 1:1 staff profile per user. This is scaffolding to
 * demonstrate the conventions (replace/extend as the real domains land):
 *
 *  - camelCase keys, no explicit column names: `casing: "snake_case"` (set on
 *    the Drizzle client AND drizzle.config.ts) maps `userId` -> `user_id`, etc.
 *  - CUID2 prefixed PK minted by `generateId("staff")` before insert.
 *  - FK with onDelete cascade; `$onUpdate` keeps `updatedAt` fresh.
 *  - Row types via `InferSelectModel` (NOT `staffProfile.$inferSelect`).
 */
export const staffProfile = pgTable("staff_profile", {
  id: text().primaryKey(),
  userId: text()
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  title: text(),
  bio: text(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export type StaffProfile = InferSelectModel<typeof staffProfile>;
