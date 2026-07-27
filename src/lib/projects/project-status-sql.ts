import "server-only";

import {
  and,
  eq,
  exists,
  inArray,
  not,
  notExists,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { db } from "@/lib/db/db";
import { projectRoles, projects } from "@/lib/db/schema";
import type { ProjectStatusBucket } from "@/lib/projects/project-derived";

/**
 * Correlated-`EXISTS` SQL predicates that select projects by their *derived*
 * status bucket, so the loader can paginate each section in the database instead
 * of fetching every project and deriving in JS. Generalises the single-bucket
 * `hasConfirmedProject` expression in `getCompaniesPage.ts` to all four buckets.
 *
 * A project's derived status depends only on *which* role statuses are present
 * (not how many — see `deriveProjectStatus`), so each bucket is a boolean
 * combination of "∃ a role with status X" over `project_roles`.
 *
 * LOCKSTEP: this MUST match `statusesMatchBucket` (the pure JS mirror) in
 * `project-derived.ts`, which in turn is guarded against `deriveProjectStatus` by
 * `project-derived.test.ts`. Change one → change all three.
 */

/** `select 1 from project_roles where project_id = projects.id [and <condition>]`. */
function roleSubquery(condition?: SQL) {
  const correlate = eq(projectRoles.projectId, projects.id);
  return db
    .select({ n: sql`1` })
    .from(projectRoles)
    .where(condition ? and(correlate, condition) : correlate);
}

// A defined SQL condition (drizzle's and/or type as `SQL | undefined` because
// their inputs may be undefined; here every input is present).
function required(condition: SQL | undefined): SQL {
  if (!condition) throw new Error("expected a defined SQL condition");
  return condition;
}

// No roles, or ∃ a tentative role → derived status "tentative".
const tentativeCondition = required(
  or(
    notExists(roleSubquery()),
    exists(roleSubquery(eq(projectRoles.status, "tentative"))),
  ),
);

// ∃ a paused role and ∄ a tentative role → derived status "paused" (paused
// outranks confirmed among live roles, but tentative outranks paused).
const pausedCondition = required(
  and(
    exists(roleSubquery(eq(projectRoles.status, "paused"))),
    notExists(roleSubquery(eq(projectRoles.status, "tentative"))),
  ),
);

// ∃ a confirmed role and ∄ a tentative/paused role → derived status "confirmed".
// This is exactly `hasConfirmedProject` from `getCompaniesPage.ts`.
const activeCondition = required(
  and(
    exists(roleSubquery(eq(projectRoles.status, "confirmed"))),
    notExists(
      roleSubquery(inArray(projectRoles.status, ["tentative", "paused"])),
    ),
  ),
);

// Everything else (cancelled). Defined as the complement of the other three so
// the buckets always partition the set — no drift possible.
const otherCondition = required(
  and(not(tentativeCondition), not(pausedCondition), not(activeCondition)),
);

const BUCKET_CONDITIONS: Record<ProjectStatusBucket, SQL> = {
  tentative: tentativeCondition,
  paused: pausedCondition,
  active: activeCondition,
  other: otherCondition,
};

const BUCKET_COUNT = Object.keys(BUCKET_CONDITIONS).length;

/**
 * A `where` condition selecting projects whose derived status is in `buckets`.
 * Returns `undefined` when every bucket is requested (no filter needed — the
 * flat, filtered list view), and a `false` guard for an empty selection.
 */
export function derivedStatusCondition(
  buckets: ProjectStatusBucket[],
): SQL | undefined {
  const unique = [...new Set(buckets)];
  if (unique.length === 0) return sql`false`;
  if (unique.length === BUCKET_COUNT) return undefined;
  const conditions = unique.map((bucket) => BUCKET_CONDITIONS[bucket]);
  return conditions.length === 1 ? conditions[0] : or(...conditions);
}
