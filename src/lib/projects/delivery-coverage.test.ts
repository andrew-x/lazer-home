import { describe, expect, test } from "bun:test";
import { addDays } from "@/lib/timesheets/timesheet-week";
import {
  type DeliveryCoverageRole,
  deliveryCoverageGaps,
  deliveryManagersOf,
} from "./delivery-coverage";

/**
 * Every date below is anchored to a **Monday**, so weekday arithmetic reads at a
 * glance and the weekend cases can be written as literal day offsets. `MON + 4` is
 * the Friday of that week; `MON + 7` the next Monday. The default window runs
 * `MON … MON + 25` — four whole weeks, Monday to Friday, so 20 weekdays.
 */
const MON = "2026-03-02";
const on = (offset: number) => addDays(MON, offset);
/** The default window's last day: the Friday four weeks out. */
const LAST = on(25);

/** An engineering line — the thing that needs managing. */
function work(
  overrides: Partial<DeliveryCoverageRole> = {},
): DeliveryCoverageRole {
  return {
    roleType: "ENGINEER",
    status: "confirmed",
    staffId: "staff-eng",
    staffName: "Engineer One",
    startDate: MON,
    endDate: LAST,
    ...overrides,
  };
}

/** A delivery line — the thing that covers. */
function delivery(
  overrides: Partial<DeliveryCoverageRole> = {},
): DeliveryCoverageRole {
  return {
    roleType: "DELIVERY",
    status: "confirmed",
    staffId: "staff-dm",
    staffName: "Dana Manager",
    startDate: MON,
    endDate: LAST,
    ...overrides,
  };
}

describe("deliveryCoverageGaps — nothing to cover", () => {
  test("no roles at all yields no gaps", () => {
    expect(deliveryCoverageGaps([])).toEqual([]);
  });

  test("a project of only delivery roles yields no gaps", () => {
    // Nothing to manage, so the window is empty — not a self-covering tautology.
    expect(deliveryCoverageGaps([delivery()])).toEqual([]);
  });

  test("a cancelled non-delivery role does not create a window", () => {
    expect(deliveryCoverageGaps([work({ status: "cancelled" })])).toEqual([]);
  });

  test("a window entirely inside a weekend has no weekdays to cover", () => {
    const saturday = on(5);
    expect(
      deliveryCoverageGaps([
        work({ startDate: saturday, endDate: addDays(saturday, 1) }),
      ]),
    ).toEqual([]);
  });
});

describe("deliveryCoverageGaps — covered plans", () => {
  test("a delivery role spanning the whole window yields no gaps", () => {
    expect(deliveryCoverageGaps([work(), delivery()])).toEqual([]);
  });

  test("overlapping delivery roles union rather than fighting", () => {
    const gaps = deliveryCoverageGaps([
      work(),
      delivery({ staffId: "dm-a", staffName: "A", endDate: on(20) }),
      delivery({ staffId: "dm-b", staffName: "B", startDate: on(10) }),
    ]);
    expect(gaps).toEqual([]);
  });

  test("roles supplied out of chronological order give the same answer", () => {
    const gaps = deliveryCoverageGaps([
      delivery({ startDate: on(14), endDate: LAST }),
      work(),
      delivery({ startDate: MON, endDate: on(13) }),
    ]);
    expect(gaps).toEqual([]);
  });
});

describe("deliveryCoverageGaps — weekends are never gap days", () => {
  test("a Friday-to-Monday handover is contiguous", () => {
    // Ends Fri of week 1, resumes Mon of week 2: the weekend between is skipped,
    // so the loop never sees an uncovered day. Without the skip, near every clean
    // handover would warn.
    const gaps = deliveryCoverageGaps([
      work(),
      delivery({ startDate: MON, endDate: on(4) }),
      delivery({ staffId: "dm-b", staffName: "B", startDate: on(7) }),
    ]);
    expect(gaps).toEqual([]);
  });

  test("a Friday-to-Tuesday handover leaves exactly the one uncovered Monday", () => {
    const gaps = deliveryCoverageGaps([
      work(),
      delivery({ startDate: MON, endDate: on(4) }),
      delivery({ staffId: "dm-b", staffName: "B", startDate: on(8) }),
    ]);
    // No minimum threshold: a single uncovered weekday is reported.
    expect(gaps).toEqual([{ startDate: on(7), endDate: on(7), weekdays: 1 }]);
  });

  test("a window starting on a Saturday reports the gap from the Monday", () => {
    const saturday = on(5);
    const gaps = deliveryCoverageGaps([
      work({ startDate: saturday, endDate: on(11) }),
    ]);
    expect(gaps).toEqual([{ startDate: on(7), endDate: on(11), weekdays: 5 }]);
  });

  test("a window ending on a Sunday reports the gap to the Friday", () => {
    // Both bounds are always weekdays, so `formatDateRange` over a gap can never
    // name a day nobody was expected to work.
    const sunday = on(13);
    const gaps = deliveryCoverageGaps([work({ endDate: sunday })]);
    expect(gaps).toEqual([{ startDate: MON, endDate: on(11), weekdays: 10 }]);
  });
});

describe("deliveryCoverageGaps — real gaps", () => {
  test("cover of the front half reports the tail, starting the next weekday", () => {
    const gaps = deliveryCoverageGaps([work(), delivery({ endDate: on(11) })]);
    // Day 11 is a Friday, so the gap opens on day 14 — the following Monday.
    expect(gaps).toEqual([{ startDate: on(14), endDate: LAST, weekdays: 10 }]);
  });

  test("no delivery role at all leaves the whole window uncovered", () => {
    const gaps = deliveryCoverageGaps([work()]);
    expect(gaps).toEqual([{ startDate: MON, endDate: LAST, weekdays: 20 }]);
  });

  test("one covered weekday splits two stretches into two chronological gaps", () => {
    const gaps = deliveryCoverageGaps([
      work(),
      delivery({ startDate: on(14), endDate: on(14) }),
    ]);
    // The first run closes on the Friday before the covered Monday, not on the
    // weekend that separates them.
    expect(gaps).toEqual([
      { startDate: MON, endDate: on(11), weekdays: 10 },
      { startDate: on(15), endDate: LAST, weekdays: 9 },
    ]);
  });

  test("a delivery role wrapping up past the last engineer does not widen the window", () => {
    // The window is the *work*, so a trailing delivery tail neither adds days nor
    // gets credit for covering days nobody was working.
    const gaps = deliveryCoverageGaps([
      work({ endDate: on(11) }),
      delivery({ startDate: MON, endDate: on(60) }),
    ]);
    expect(gaps).toEqual([]);
  });
});

describe("deliveryCoverageGaps — which roles count", () => {
  test("a tentative delivery role covers a confirmed engineering span", () => {
    // The judgement call, asserted on purpose. Confirmed-only coverage would light
    // up every plan born from an unwon opportunity as wholly uncovered at exactly
    // the moment nothing is real yet.
    const gaps = deliveryCoverageGaps([
      work({ status: "confirmed" }),
      delivery({ status: "tentative" }),
    ]);
    expect(gaps).toEqual([]);
  });

  test("a paused delivery role covers", () => {
    expect(
      deliveryCoverageGaps([work(), delivery({ status: "paused" })]),
    ).toEqual([]);
  });

  test("a cancelled delivery role does not cover", () => {
    const gaps = deliveryCoverageGaps([
      work(),
      delivery({ status: "cancelled" }),
    ]);
    expect(gaps).toEqual([{ startDate: MON, endDate: LAST, weekdays: 20 }]);
  });

  test("an open delivery role does not cover", () => {
    // Asserted on purpose: a seat nobody sits in contains no delivery manager, so
    // flipping this policy is a one-line, visible change.
    const gaps = deliveryCoverageGaps([
      work(),
      delivery({ staffId: null, staffName: null }),
    ]);
    expect(gaps).toEqual([{ startDate: MON, endDate: LAST, weekdays: 20 }]);
  });

  test("a cancelled engineering tail does not demand coverage forever", () => {
    const gaps = deliveryCoverageGaps([
      work({ endDate: on(11) }),
      work({ staffId: "eng-2", startDate: on(14), status: "cancelled" }),
      delivery({ endDate: on(11) }),
    ]);
    expect(gaps).toEqual([]);
  });
});

describe("deliveryManagersOf", () => {
  test("distinct people, name-ordered, with their spans", () => {
    const managers = deliveryManagersOf([
      work(),
      delivery({ staffId: "dm-z", staffName: "Zoe", startDate: on(14) }),
      delivery({ staffId: "dm-a", staffName: "Amy", endDate: on(13) }),
    ]);
    expect(managers).toEqual([
      { id: "dm-a", name: "Amy", spans: [{ startDate: MON, endDate: on(13) }] },
      {
        id: "dm-z",
        name: "Zoe",
        spans: [{ startDate: on(14), endDate: LAST }],
      },
    ]);
  });

  test("one person holding two delivery roles is listed once, spans chronological", () => {
    const managers = deliveryManagersOf([
      delivery({ startDate: on(14), endDate: LAST }),
      delivery({ startDate: MON, endDate: on(11) }),
    ]);
    expect(managers).toHaveLength(1);
    expect(managers[0]?.spans).toEqual([
      { startDate: MON, endDate: on(11) },
      { startDate: on(14), endDate: LAST },
    ]);
  });

  test("non-delivery, cancelled and open roles contribute no names", () => {
    expect(
      deliveryManagersOf([
        work(),
        delivery({ status: "cancelled" }),
        delivery({ staffId: null, staffName: null }),
      ]),
    ).toEqual([]);
  });
});
