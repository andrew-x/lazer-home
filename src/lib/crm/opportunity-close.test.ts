import { describe, expect, test } from "bun:test";
import { OPPORTUNITY_STATUSES } from "@/lib/crm/opportunity";
import { closedAtFor, isClosedStatus } from "@/lib/crm/opportunity-close";

const NOW = new Date("2026-08-04T14:30:00");
const EARLIER = new Date("2026-06-01T09:00:00");

describe("isClosedStatus", () => {
  test("only the two terminal statuses are closed", () => {
    const closed = OPPORTUNITY_STATUSES.filter(isClosedStatus);
    expect(closed).toEqual(["closed_won", "closed_lost"]);
  });
});

describe("closedAtFor", () => {
  test("open → closed stamps now", () => {
    expect(closedAtFor("negotiating", "closed_won", NOW)).toBe(NOW);
    expect(closedAtFor("qualifying", "closed_lost", NOW)).toBe(NOW);
  });

  test("re-saving a closed deal keeps its original close instant", () => {
    // Dragging a won card around inside the Won column must not move it into
    // this week — the whole reason this isn't `updatedAt`.
    expect(closedAtFor("closed_won", "closed_won", NOW, EARLIER)).toBe(EARLIER);
  });

  test("won → lost keeps the original instant: a correction, not a new decision", () => {
    expect(closedAtFor("closed_won", "closed_lost", NOW, EARLIER)).toBe(
      EARLIER,
    );
    expect(closedAtFor("closed_lost", "closed_won", NOW, EARLIER)).toBe(
      EARLIER,
    );
  });

  test("closed → closed with no recorded instant falls back to now, never null", () => {
    // A row that predates the column and escaped the backfill would otherwise
    // violate `opportunities_closed_at_shape`.
    expect(closedAtFor("closed_won", "closed_lost", NOW, null)).toBe(NOW);
  });

  test("reopening a closed deal clears the close date", () => {
    expect(closedAtFor("closed_won", "negotiating", NOW, EARLIER)).toBeNull();
    expect(closedAtFor("closed_lost", "scoping", NOW, EARLIER)).toBeNull();
  });

  test("open → open is null", () => {
    expect(closedAtFor("lead", "qualifying", NOW)).toBeNull();
    expect(
      closedAtFor("scoping", "scoping_reviewing", NOW, EARLIER),
    ).toBeNull();
  });

  test("insert: closed_lost stamps now, an open status is null", () => {
    // `createOpportunity` can create a deal directly as `closed_lost`
    // (`requiresProject("closed_lost")` is false, so nothing blocks it).
    expect(closedAtFor(null, "closed_lost", NOW)).toBe(NOW);
    expect(closedAtFor(null, "maturing", NOW)).toBeNull();
  });

  test("across every transition, closedAt is non-null iff the next status is closed", () => {
    // The `opportunities_closed_at_shape` CHECK restated in TypeScript: 14 × 14
    // ordered pairs plus the 14 insert cases. This is the invariant the DB
    // constraint enforces, so the two representations can't drift.
    for (const next of OPPORTUNITY_STATUSES) {
      const wantClosed = isClosedStatus(next);

      expect(closedAtFor(null, next, NOW) !== null).toBe(wantClosed);

      for (const prev of OPPORTUNITY_STATUSES) {
        expect(closedAtFor(prev, next, NOW, EARLIER) !== null).toBe(wantClosed);
        // …and with no previous instant recorded, which must not produce a null
        // for a closed target.
        expect(closedAtFor(prev, next, NOW, null) !== null).toBe(wantClosed);
      }
    }
  });
});
