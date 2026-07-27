import { describe, expect, test } from "bun:test";
import {
  deriveProjectStatus,
  PROJECT_STATUS_BUCKETS,
  projectStatusBucket,
  statusesMatchBucket,
} from "./project-derived";
import {
  PROJECT_ROLE_STATUSES,
  type ProjectRoleStatus,
} from "./project-role-status";

const BUCKETS = PROJECT_STATUS_BUCKETS;

/**
 * A project's derived status — and therefore its list-section bucket — depends
 * only on *which* role statuses are present, not how many. So enumerating every
 * subset of the four statuses (16 presence combinations) covers the whole space.
 * Each combination becomes a representative `roleStatuses[]` (one role per
 * present status).
 */
function presenceCombinations(): ProjectRoleStatus[][] {
  const statuses = [...PROJECT_ROLE_STATUSES];
  const combos: ProjectRoleStatus[][] = [];
  for (let mask = 0; mask < 1 << statuses.length; mask++) {
    combos.push(statuses.filter((_, i) => mask & (1 << i)));
  }
  return combos;
}

describe("statusesMatchBucket agrees with deriveProjectStatus", () => {
  test("every role-status combination lands in exactly one bucket", () => {
    for (const roleStatuses of presenceCombinations()) {
      const matched = BUCKETS.filter((bucket) =>
        statusesMatchBucket(bucket, roleStatuses),
      );
      // The buckets must partition the space: exactly one matches.
      expect(matched).toHaveLength(1);
    }
  });

  test("the matching bucket is the one deriveProjectStatus falls into", () => {
    for (const roleStatuses of presenceCombinations()) {
      const truth = projectStatusBucket(deriveProjectStatus(roleStatuses));
      for (const bucket of BUCKETS) {
        expect(statusesMatchBucket(bucket, roleStatuses)).toBe(
          bucket === truth,
        );
      }
    }
  });
});
