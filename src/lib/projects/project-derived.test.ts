import { describe, expect, test } from "bun:test";
import {
  deriveProjectStatus,
  PROJECT_STATUS_BUCKETS,
  projectHasEnded,
  projectStatusBucket,
  statusesMatchBucket,
} from "./project-derived";
import {
  PROJECT_ROLE_STATUSES,
  type ProjectRoleStatus,
} from "./project-role-status";

const BUCKETS = PROJECT_STATUS_BUCKETS;

/**
 * A project's derived status depends only on *which* role statuses are present,
 * not how many. So enumerating every subset of the four statuses (16 presence
 * combinations) covers the whole status space; crossed with `END_DATES` — the
 * only other input to the bucket — that covers the whole bucket space. Each
 * combination becomes a representative `roleStatuses[]` (one role per present
 * status).
 */
function presenceCombinations(): ProjectRoleStatus[][] {
  const statuses = [...PROJECT_ROLE_STATUSES];
  const combos: ProjectRoleStatus[][] = [];
  for (let mask = 0; mask < 1 << statuses.length; mask++) {
    combos.push(statuses.filter((_, i) => mask & (1 << i)));
  }
  return combos;
}

const TODAY = "2026-07-29";
/**
 * The end-date dimension: a confirmed project splits into Active or Past on it,
 * and every other bucket must ignore it. `null` is the no-roles case; `TODAY`
 * pins the boundary (a project ending today is still running).
 */
const END_DATES = [null, "2020-01-01", TODAY, "2030-12-31"];

describe("statusesMatchBucket agrees with deriveProjectStatus", () => {
  test("every role-status × end-date combination lands in exactly one bucket", () => {
    for (const roleStatuses of presenceCombinations()) {
      for (const endDate of END_DATES) {
        const matched = BUCKETS.filter((bucket) =>
          statusesMatchBucket(bucket, roleStatuses, endDate, TODAY),
        );
        // The buckets must partition the space: exactly one matches.
        expect(matched).toHaveLength(1);
      }
    }
  });

  test("the matching bucket is the one deriveProjectStatus falls into", () => {
    for (const roleStatuses of presenceCombinations()) {
      for (const endDate of END_DATES) {
        const truth = projectStatusBucket(
          deriveProjectStatus(roleStatuses),
          endDate,
          TODAY,
        );
        for (const bucket of BUCKETS) {
          expect(
            statusesMatchBucket(bucket, roleStatuses, endDate, TODAY),
          ).toBe(bucket === truth);
        }
      }
    }
  });
});

describe("the active/past split", () => {
  test("only a finished engagement is past — ending today still counts as running", () => {
    expect(projectHasEnded("2026-07-28", TODAY)).toBe(true);
    expect(projectHasEnded(TODAY, TODAY)).toBe(false);
    expect(projectHasEnded("2026-07-30", TODAY)).toBe(false);
    expect(projectHasEnded(null, TODAY)).toBe(false);
  });

  test("it applies to confirmed projects only", () => {
    const ended = "2020-01-01";
    expect(projectStatusBucket("confirmed", ended, TODAY)).toBe("past");
    expect(projectStatusBucket("confirmed", "2030-12-31", TODAY)).toBe(
      "active",
    );
    // A long-finished project that was never confirmed keeps its own bucket.
    expect(projectStatusBucket("tentative", ended, TODAY)).toBe("tentative");
    expect(projectStatusBucket("paused", ended, TODAY)).toBe("paused");
    expect(projectStatusBucket("cancelled", ended, TODAY)).toBe("cancelled");
  });
});
