import { describe, expect, test } from "bun:test";
import {
  OPPORTUNITY_STATUSES,
  type OpportunityStatus,
} from "@/lib/crm/opportunity";
import { OPPORTUNITY_GROUPS } from "@/lib/crm/opportunity-pipeline";
import {
  bandOfStatus,
  type ClosedDeal,
  FUNNEL_BANDS,
  FUNNEL_STATUSES,
  type FunnelDeal,
  groupMyDealsByStage,
  NON_FUNNEL_GROUP_IDS,
  type ProjectValue,
  summarizeClosed,
  summarizeFunnel,
  summarizePipeline,
} from "@/lib/home/pipeline";

const deal = (
  status: OpportunityStatus,
  projectId: string | null = null,
): FunnelDeal => ({ status, projectId });

const plans = (
  entries: Record<string, ProjectValue>,
): ReadonlyMap<string, ProjectValue> => new Map(Object.entries(entries));

const fixedFee = (revenue: number | null): ProjectValue => ({
  billingType: "FIXED_FEE",
  revenue,
});
const tandm = (revenue: number | null): ProjectValue => ({
  billingType: "TIME_AND_MATERIALS",
  revenue,
});

const bandById = (bands: ReturnType<typeof summarizeFunnel>, id: string) => {
  const band = bands.find((b) => b.id === id);
  if (!band) throw new Error(`no band ${id}`);
  return band;
};

describe("the funnel partition", () => {
  test("every pipeline group is classified exactly once", () => {
    const classified = [
      ...FUNNEL_BANDS.flatMap((b) => b.groupIds),
      ...NON_FUNNEL_GROUP_IDS,
    ];
    expect([...classified].sort()).toEqual(
      OPPORTUNITY_GROUPS.map((g) => g.id).sort(),
    );
  });

  test("maturing, won and lost are the three deliberate exclusions", () => {
    expect([...NON_FUNNEL_GROUP_IDS]).toEqual(["maturing", "won", "lost"]);
  });

  test("FUNNEL_STATUSES is in pipeline order and excludes maturing and the closed statuses", () => {
    const expected = OPPORTUNITY_STATUSES.filter(
      (s) => bandOfStatus(s) !== null,
    );
    expect([...FUNNEL_STATUSES]).toEqual([...expected]);
    expect(FUNNEL_STATUSES).not.toContain("maturing");
    expect(FUNNEL_STATUSES).not.toContain("closed_won");
    expect(FUNNEL_STATUSES).not.toContain("closed_lost");
  });

  test("bandOfStatus places the six funnel groups and nothing else", () => {
    expect(bandOfStatus("lead")).toBe("top");
    expect(bandOfStatus("qualifying")).toBe("top");
    expect(bandOfStatus("scoping_reviewing")).toBe("mid");
    expect(bandOfStatus("allocating_introing_profiles")).toBe("mid");
    expect(bandOfStatus("negotiating")).toBe("bottom");
    expect(bandOfStatus("closing_redlining")).toBe("bottom");
    expect(bandOfStatus("maturing")).toBeNull();
    expect(bandOfStatus("closed_won")).toBeNull();
    expect(bandOfStatus("closed_lost")).toBeNull();
  });
});

describe("summarizeFunnel — counts", () => {
  test("leaf counts sum to their band's deal count", () => {
    const bands = summarizeFunnel(
      [
        deal("lead"),
        deal("lead"),
        deal("qualifying"),
        deal("scoping"),
        deal("negotiating"),
      ],
      plans({}),
    );
    for (const band of bands) {
      expect(band.stages.reduce((n, s) => n + s.count, 0)).toBe(band.deals);
    }
    expect(bandById(bands, "top").deals).toBe(3);
    expect(bandById(bands, "mid").deals).toBe(1);
    expect(bandById(bands, "bottom").deals).toBe(1);
  });

  test("zero-count leaves are retained so the block's shape is filter-stable", () => {
    const bands = summarizeFunnel([deal("scoping")], plans({}));
    const mid = bandById(bands, "mid");
    // Scoping's three substatuses plus Allocating's two.
    expect(mid.stages).toHaveLength(5);
    expect(
      mid.stages.find((s) => s.status === "scoping_reviewing")?.count,
    ).toBe(0);
  });

  test("deals outside the funnel are ignored entirely", () => {
    const bands = summarizeFunnel(
      [deal("maturing"), deal("closed_won"), deal("closed_lost")],
      plans({}),
    );
    expect(bands.every((b) => b.deals === 0)).toBe(true);
  });

  test("Top of funnel reports no money; Mid and Bottom do", () => {
    const bands = summarizeFunnel([deal("lead")], plans({}));
    expect(bandById(bands, "top").value).toBeNull();
    expect(bandById(bands, "mid").value).not.toBeNull();
    expect(bandById(bands, "bottom").value).not.toBeNull();
  });
});

describe("summarizeFunnel — value and the per-band dedupe", () => {
  test("two deals in one band on one project count the value once", () => {
    const bands = summarizeFunnel(
      [deal("scoping", "p1"), deal("allocating_awaiting_profiles", "p1")],
      plans({ p1: fixedFee(500_000) }),
    );
    const mid = bandById(bands, "mid");
    expect(mid.deals).toBe(2);
    expect(mid.value?.pricedProjects).toBe(1);
    expect(mid.value?.fixedFee).toBe(500_000);
    expect(mid.value?.total).toBe(500_000);
  });

  test("one project reached from two bands counts in each — the deliberate cross-band double count", () => {
    const bands = summarizeFunnel(
      [deal("scoping", "p1"), deal("negotiating", "p1")],
      plans({ p1: fixedFee(500_000) }),
    );
    expect(bandById(bands, "mid").value?.total).toBe(500_000);
    expect(bandById(bands, "bottom").value?.total).toBe(500_000);
  });

  test("fixed fee and time & materials are summed separately and stated as a total", () => {
    const bands = summarizeFunnel(
      [deal("negotiating", "p1"), deal("closing_redlining", "p2")],
      plans({ p1: fixedFee(300_000), p2: tandm(120_000) }),
    );
    const value = bandById(bands, "bottom").value;
    expect(value?.fixedFee).toBe(300_000);
    expect(value?.timeAndMaterials).toBe(120_000);
    expect(value?.total).toBe(420_000);
    expect(value?.pricedProjects).toBe(2);
  });

  test("all four unpriced cases are counted as unpriced, never as zero value", () => {
    const bands = summarizeFunnel(
      [
        deal("scoping", null), //           no linked project
        deal("scoping", "missing"), //      linked, but no plan row
        deal("scoping", "noBilling"), //    no billing model
        deal("scoping", "unbuilt"), //      T&M with no counted roles
      ],
      plans({
        noBilling: { billingType: null, revenue: null },
        unbuilt: tandm(null),
      }),
    );
    const value = bandById(bands, "mid").value;
    expect(value?.unpricedDeals).toBe(4);
    expect(value?.pricedProjects).toBe(0);
    expect(value?.fixedFee).toBeNull();
    expect(value?.timeAndMaterials).toBeNull();
  });

  test("an unstaffed FIXED FEE plan is still priced — the fee doesn't depend on roles", () => {
    // The common state of a deal at Negotiating: fee agreed, plan not built yet.
    // `getPlanRevenueByProject` nulls a roles-derived total only for T&M, so this
    // arrives here as a real number and must be counted.
    const bands = summarizeFunnel(
      [deal("negotiating", "signedNoRoles")],
      plans({ signedNoRoles: fixedFee(750_000) }),
    );
    const value = bandById(bands, "bottom").value;
    expect(value?.fixedFee).toBe(750_000);
    expect(value?.unpricedDeals).toBe(0);
    expect(value?.pricedProjects).toBe(1);
  });

  test("a band with deals but nothing priced reports null, never 0", () => {
    const bands = summarizeFunnel([deal("negotiating")], plans({}));
    const value = bandById(bands, "bottom").value;
    expect(value?.total).toBeNull();
    expect(value?.total).not.toBe(0);
    expect(value?.unpricedDeals).toBe(1);
  });

  test("an empty band reports zero deals and a null total", () => {
    const bands = summarizeFunnel([], plans({}));
    expect(bands).toHaveLength(3);
    expect(bands.every((b) => b.deals === 0)).toBe(true);
    expect(bandById(bands, "mid").value?.total).toBeNull();
    expect(bandById(bands, "mid").value?.unpricedDeals).toBe(0);
  });

  test("total equals the two halves whenever either is present", () => {
    const bands = summarizeFunnel(
      [deal("negotiating", "p1"), deal("closing_redlining", "p2")],
      plans({ p1: fixedFee(100), p2: tandm(50) }),
    );
    const value = bandById(bands, "bottom").value;
    expect(value?.total).toBe(
      (value?.fixedFee ?? 0) + (value?.timeAndMaterials ?? 0),
    );
  });
});

describe("summarizeClosed", () => {
  const rows: ClosedDeal[] = [
    { status: "closed_won", closedOn: "2026-08-03" }, // exactly weekStart
    { status: "closed_won", closedOn: "2026-08-04" },
    { status: "closed_lost", closedOn: "2026-08-04" },
    { status: "closed_won", closedOn: "2026-08-01" }, // exactly monthStart
    { status: "closed_lost", closedOn: "2026-07-20" }, // neither window
  ];

  test("a deal on weekStart is in the week; one on monthStart is in the month", () => {
    const closed = summarizeClosed(rows, "2026-08-03", "2026-08-01");
    expect(closed.week).toEqual({ won: 2, lost: 1 });
    expect(closed.month).toEqual({ won: 3, lost: 1 });
  });

  test("a deal before both windows is counted in neither", () => {
    const closed = summarizeClosed(
      [{ status: "closed_lost", closedOn: "2026-07-20" }],
      "2026-08-03",
      "2026-08-01",
    );
    expect(closed.week).toEqual({ won: 0, lost: 0 });
    expect(closed.month).toEqual({ won: 0, lost: 0 });
  });

  test("the week can start before the month, so neither figure is a subset of the other", () => {
    // Today is Wed 2 Sep 2026; the Monday-start week began 31 Aug — in August.
    const closed = summarizeClosed(
      [
        { status: "closed_won", closedOn: "2026-08-31" }, // in the week, NOT the month
        { status: "closed_won", closedOn: "2026-09-01" }, // in both
      ],
      "2026-08-31",
      "2026-09-01",
    );
    expect(closed.week.won).toBe(2);
    expect(closed.month.won).toBe(1);
    // The month is not a superset of the week here — the whole point.
    expect(closed.month.won).toBeLessThan(closed.week.won);
  });

  test("won and lost are split, and a non-closed status is never counted as a win", () => {
    const closed = summarizeClosed(
      [
        { status: "closed_won", closedOn: "2026-08-04" },
        { status: "closed_lost", closedOn: "2026-08-04" },
        // Defensive: the read bounds by status, but a fold must not credit this.
        { status: "negotiating", closedOn: "2026-08-04" },
      ],
      "2026-08-03",
      "2026-08-01",
    );
    expect(closed.week).toEqual({ won: 1, lost: 1 });
  });

  test("no rows means zeros, not nulls — a count of nothing is a real zero", () => {
    const closed = summarizeClosed([], "2026-08-03", "2026-08-01");
    expect(closed).toEqual({
      week: { won: 0, lost: 0 },
      month: { won: 0, lost: 0 },
    });
  });
});

describe("summarizePipeline", () => {
  test("openDeals is the total the bands partition", () => {
    const summary = summarizePipeline(
      [
        deal("lead"),
        deal("scoping", "p1"),
        deal("negotiating"),
        deal("maturing"),
      ],
      plans({ p1: tandm(90_000) }),
      [{ status: "closed_won", closedOn: "2026-08-04" }],
      "2026-08-03",
      "2026-08-01",
    );
    expect(summary.openDeals).toBe(3); // maturing excluded
    expect(summary.bands.reduce((n, b) => n + b.deals, 0)).toBe(
      summary.openDeals,
    );
    expect(summary.closed.week.won).toBe(1);
  });

  test("the org payload carries no deal names, company names or ids", () => {
    // ADR 0063 §5: this fold's output is a Client Component prop, so it is
    // serialized into the page HTML for every viewer. Asserted against the
    // SERIALIZED payload rather than a field list, so a future spread that
    // reintroduces an identifiable field fails here instead of passing vacuously.
    const summary = summarizePipeline(
      [
        deal("scoping", "project-acme-confidential"),
        deal("negotiating", "project-globex-confidential"),
      ],
      plans({
        "project-acme-confidential": fixedFee(500_000),
        "project-globex-confidential": tandm(120_000),
      }),
      [{ status: "closed_won", closedOn: "2026-08-04" }],
      "2026-08-03",
      "2026-08-01",
    );
    const payload = JSON.stringify(summary);
    expect(payload).not.toContain("acme");
    expect(payload).not.toContain("globex");
    expect(payload).not.toContain("confidential");
    expect(payload).not.toContain("projectId");
  });
});

describe("groupMyDealsByStage", () => {
  const owned = (
    status: OpportunityStatus,
    value: number | null,
    name = "deal",
  ) => ({ status, value, name });

  test("stages come back in pipeline order with empty ones dropped", () => {
    const stages = groupMyDealsByStage([
      owned("negotiating", 100),
      owned("lead", null),
      owned("scoping", 200),
    ]);
    expect(stages.map((s) => s.status)).toEqual([
      "lead",
      "scoping",
      "negotiating",
    ]);
  });

  test("a stage's value sums only its priced deals", () => {
    const stages = groupMyDealsByStage([
      owned("negotiating", 100),
      owned("negotiating", null),
      owned("negotiating", 50),
    ]);
    expect(stages[0].deals).toHaveLength(3);
    expect(stages[0].value).toBe(150);
  });

  test("a stage with nothing priced reports null, never 0", () => {
    const stages = groupMyDealsByStage([owned("scoping", null)]);
    expect(stages[0].value).toBeNull();
  });

  test("non-funnel deals are dropped — Maturing is excluded here too", () => {
    const stages = groupMyDealsByStage([
      owned("maturing", null),
      owned("closed_won", 400),
      owned("closed_lost", null),
    ]);
    expect(stages).toEqual([]);
  });

  test("deal order within a stage is preserved", () => {
    const stages = groupMyDealsByStage([
      owned("scoping", 1, "first"),
      owned("scoping", 2, "second"),
    ]);
    expect(stages[0].deals.map((d) => d.name)).toEqual(["first", "second"]);
  });

  test("no deals means no stages", () => {
    expect(groupMyDealsByStage([])).toEqual([]);
  });
});
