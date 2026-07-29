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
import {
  PROJECT_STATUS_BUCKETS,
  type ProjectStatusBucket,
} from "@/lib/projects/project-derived";

/**
 * Correlated-`EXISTS` SQL predicates that select projects by their *derived*
 * status bucket, so the loader can paginate each section in the database instead
 * of fetching every project and deriving in JS. Generalises the single-bucket
 * `hasConfirmedProject` expression in `getCompaniesPage.ts` to all five buckets.
 *
 * A project's derived status depends only on *which* role statuses are present
 * (not how many — see `deriveProjectStatus`), so each status is a boolean
 * combination of "∃ a role with status X" over `project_roles`. The confirmed
 * status then splits into the `active` and `past` buckets on the project's latest
 * role end date, the one date-sensitive part of this module.
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
// This is exactly `hasConfirmedProject` from `getCompaniesPage.ts`. Confirmed
// spans two buckets — `active` (still running) and `past` (finished).
const confirmedCondition = required(
  and(
    exists(roleSubquery(eq(projectRoles.status, "confirmed"))),
    notExists(
      roleSubquery(inArray(projectRoles.status, ["tentative", "paused"])),
    ),
  ),
);

// Everything else (cancelled). Defined as the complement of the other three
// *statuses* so the buckets always partition the set — no drift possible.
const cancelledCondition = required(
  and(not(tentativeCondition), not(pausedCondition), not(confirmedCondition)),
);

/**
 * The project's latest role end date, as a correlated `max` over `project_roles`
 * — the end of the engagement. Null only when the project has no roles (which
 * reads as tentative). Also the projects list's `endDate` sort key.
 */
export const latestRoleEndDate = sql`(select max(${projectRoles.endDate}) from ${projectRoles} where ${projectRoles.projectId} = ${projects.id})`;

// The engagement finished before `today`. A project ending today still counts as
// running, matching `projectHasEnded`.
function endedCondition(today: string): SQL {
  return sql`${latestRoleEndDate} < ${today}::date`;
}

/**
 * The predicate per bucket for a given `today`. Built per call because the
 * active/past split depends on the date; the status-only conditions are module
 * constants shared across calls.
 */
function bucketConditions(today: string): Record<ProjectStatusBucket, SQL> {
  const ended = endedCondition(today);
  return {
    tentative: tentativeCondition,
    paused: pausedCondition,
    // `confirmed` guarantees at least one role, so `latestRoleEndDate` is never
    // null here and `not(ended)` can't go three-valued.
    active: required(and(confirmedCondition, not(ended))),
    past: required(and(confirmedCondition, ended)),
    cancelled: cancelledCondition,
  };
}

const BUCKET_COUNT = PROJECT_STATUS_BUCKETS.length;

/**
 * A `where` condition selecting projects whose derived status bucket is in
 * `buckets`, with `today` deciding the active/past split. Returns `undefined`
 * when every bucket is requested (no filter needed — the flat, filtered list
 * view), and a `false` guard for an empty selection.
 */
export function derivedStatusCondition(
  buckets: ProjectStatusBucket[],
  today: string,
): SQL | undefined {
  const unique = [...new Set(buckets)];
  if (unique.length === 0) return sql`false`;
  if (unique.length === BUCKET_COUNT) return undefined;
  const conditions = bucketConditions(today);
  const selected = unique.map((bucket) => conditions[bucket]);
  return selected.length === 1 ? selected[0] : or(...selected);
}
