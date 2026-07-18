import { desc } from "drizzle-orm";
import { staffEmployment } from "@/lib/db/schema";

/**
 * Canonical ordering for "current employment wins": highest `effectiveFromDate`,
 * then latest `createdAt` to break same-day ties (ADR 0007). Spread into a
 * query's `.orderBy(...)` so the first row per staff is the current fact.
 *
 * Every read that resolves the latest employment row shares this ordering
 * (directory, profile, history, comp summary, bulk-edit, staff import). Each
 * call site keeps its own explicit column projection — only the ordering (the
 * effective-dating rule) is centralized, so it can never drift row-to-row.
 *
 * A pure query fragment (no `db`) — safe to import from both the actions layer
 * and the import compute helper (`staff-import/plan.ts`).
 */
export const latestEmploymentFirst = [
  desc(staffEmployment.effectiveFromDate),
  desc(staffEmployment.createdAt),
] as const;
