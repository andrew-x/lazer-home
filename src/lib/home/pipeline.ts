/**
 * The home dashboard's **sales pipeline** folds: open deals grouped into three
 * funnel bands, their plan value, and the deals decided this week and this month.
 * A pure, client-importable module (no `db`/drizzle, no React) sitting beside
 * `org-status.ts` (point-in-time staffing) and `my-tasks.ts`. See
 * docs/decisions/0069.
 *
 * ## Three bands, and the three groups deliberately left out
 *
 * `OPPORTUNITY_GROUPS` has nine columns; the funnel is six of them, in three
 * bands. `maturing`, `won` and `lost` are named in {@link NON_FUNNEL_GROUP_IDS}
 * with their reasons, and a module-load assertion below makes that classification
 * **structural**: add a tenth pipeline group and this module throws at import
 * until somebody decides where it goes. So the bands not summing to the board's
 * open-card total is a recorded decision, not an oversight — which is why both
 * panels caption "Excludes Maturing".
 *
 * ## Two time bases in one block, both named
 *
 * Stage counts and band values are **point in time** — open right now. The closed
 * counts are **windowed** — this week, this month. Both are here because a
 * pipeline without outcomes doesn't say whether the org is winning; but ADR 0063
 * bans an unlabelled figure on this page, so the UI must name each window, and
 * these two are **not nested**: a Monday-start week can begin in the previous
 * month, so a deal can be in `week` and not in `month`. {@link summarizeClosed}
 * evaluates the two independently and never treats one as a subset of the other.
 *
 * ## A plan is priced or it isn't — never zero
 *
 * `revenue: null` means "can't be priced" (no project, no billing model, or a
 * **time-and-materials** plan with no counted roles) and renders as "—". That last
 * case matters because T&M revenue is a sum over counted roles, and an empty sum is
 * a confident `0` — so a signed T&M project whose plan hasn't been built yet would
 * otherwise report "no work sold", a lie rather than a zero. A fixed fee is a
 * contracted total that doesn't depend on staffing, so it stays priced even with no
 * roles. `getPlanRevenueByProject` owns that distinction; this module just honours
 * whatever `null` it is handed.
 */

import {
  OPPORTUNITY_STATUSES,
  type OpportunityStatus,
  STATUS_LABELS,
} from "@/lib/crm/opportunity";
import {
  OPPORTUNITY_GROUPS,
  type OpportunityGroupId,
  opportunityGroupById,
} from "@/lib/crm/opportunity-pipeline";
import type { DisplayCurrency } from "@/lib/format/currency";
import type { BillingType } from "@/lib/projects/project-billing";

// --- The funnel ------------------------------------------------------------

export type FunnelBandId = "top" | "mid" | "bottom";

export type FunnelBand = {
  id: FunnelBandId;
  label: string;
  /** The pipeline groups in this band, in pipeline order. */
  groupIds: readonly OpportunityGroupId[];
  /**
   * Whether this band reports money. False for Top: a lead has no scoped work, so
   * a plan value there would be an absence dressed up as a figure.
   */
  reportsValue: boolean;
};

/** The three funnel bands, in pipeline order. */
export const FUNNEL_BANDS: readonly FunnelBand[] = [
  {
    id: "top",
    label: "Top of funnel",
    groupIds: ["lead", "qualifying"],
    reportsValue: false,
  },
  {
    id: "mid",
    label: "Mid funnel",
    groupIds: ["scoping", "allocating"],
    reportsValue: true,
  },
  {
    id: "bottom",
    label: "Bottom of funnel",
    groupIds: ["negotiating", "closing"],
    reportsValue: true,
  },
];

/**
 * Pipeline groups that belong to no funnel band, each for its own reason:
 *
 * - **`maturing`** — a holding pen, not a stage the funnel forecasts from. Deals
 *   sit there indefinitely without anyone working them, so counting them would
 *   inflate the top of the funnel with work nobody is doing. A product decision,
 *   recorded here so it isn't "fixed" back in.
 * - **`won` / `lost`** — outcomes, not stages. They're counted separately and
 *   **windowed** (this week, this month), because the cumulative total of every
 *   deal ever decided says nothing a dashboard can act on.
 */
export const NON_FUNNEL_GROUP_IDS: readonly OpportunityGroupId[] = [
  "maturing",
  "won",
  "lost",
];

/**
 * Every leaf status inside a funnel band, in `OPPORTUNITY_STATUSES` order. The
 * reads' `WHERE status IN (…)` list, so the SQL and the bands cannot disagree
 * about what counts as a funnel stage.
 */
export const FUNNEL_STATUSES: readonly OpportunityStatus[] =
  FUNNEL_BANDS.flatMap((band) =>
    band.groupIds.flatMap((id) => opportunityGroupById(id).statuses),
  );

/**
 * The leaf statuses in bands that report money — the subset of
 * {@link FUNNEL_STATUSES} whose linked projects need pricing. Lets a read leave
 * top-of-funnel projects out of the role scan entirely.
 */
export const VALUED_FUNNEL_STATUSES: readonly OpportunityStatus[] =
  FUNNEL_BANDS.filter((band) => band.reportsValue).flatMap((band) =>
    band.groupIds.flatMap((id) => opportunityGroupById(id).statuses),
  );

/**
 * The currency every money figure on the home dashboard's pipeline block is
 * expressed in. Its value coincides with `MARGIN_FLAG_CURRENCY` but it is
 * deliberately **not** that constant — that one is the currency a margin
 * *threshold* is evaluated in, a different question that may move independently.
 *
 * There is no currency toggle on `/`: a toggle means client state plus a second
 * figure to reconcile, and this block names its currency in a footnote instead.
 */
export const PIPELINE_DISPLAY_CURRENCY: DisplayCurrency = "CAD";

const bandByStatus = new Map<OpportunityStatus, FunnelBandId>();
for (const band of FUNNEL_BANDS) {
  for (const groupId of band.groupIds) {
    for (const status of opportunityGroupById(groupId).statuses) {
      bandByStatus.set(status, band.id);
    }
  }
}

/** The funnel band a status sits in, or null if it's outside the funnel. */
export function bandOfStatus(status: OpportunityStatus): FunnelBandId | null {
  return bandByStatus.get(status) ?? null;
}

// Lockstep guard, mirroring `opportunity-pipeline.ts`'s own: every pipeline group
// must be classified exactly once, either into a band or as a stated exclusion.
// This is what makes omitting Maturing a decision rather than a gap — a new group
// fails at import until someone places it.
{
  const classified = [
    ...FUNNEL_BANDS.flatMap((b) => b.groupIds),
    ...NON_FUNNEL_GROUP_IDS,
  ];
  const all = OPPORTUNITY_GROUPS.map((g) => g.id);
  const missing = all.filter((id) => !classified.includes(id));
  const duplicated = classified.filter((id, i) => classified.indexOf(id) !== i);
  if (missing.length > 0 || duplicated.length > 0) {
    throw new Error(
      `home/pipeline: every OPPORTUNITY_GROUPS id must be classified exactly once into FUNNEL_BANDS or NON_FUNNEL_GROUP_IDS. Unclassified: [${missing.join(", ")}]. Duplicated: [${duplicated.join(", ")}].`,
    );
  }
}

// --- Fold outputs ----------------------------------------------------------

export type StageCount = {
  status: OpportunityStatus;
  label: string;
  count: number;
};

export type BandValue = {
  /**
   * Σ plan value over the band's DISTINCT fixed-fee projects. Null — never 0 —
   * when the band has no priced fixed-fee plan.
   */
  fixedFee: number | null;
  /** The same over distinct time-and-materials projects. */
  timeAndMaterials: number | null;
  /** `fixedFee + timeAndMaterials`, stated rather than left to the reader. */
  total: number | null;
  /** Open deals in this band with no priceable plan. */
  unpricedDeals: number;
  /** Distinct projects behind `total` — the honest denominator for the dedupe. */
  pricedProjects: number;
};

export type FunnelBandSummary = {
  id: FunnelBandId;
  label: string;
  /** Open DEALS in the band — not projects, see `BandValue.pricedProjects`. */
  deals: number;
  /**
   * Per-leaf counts in pipeline order. Zero rows are **retained** so the block's
   * shape doesn't shift as a filter changes — a stage vanishing at 0 reads as a
   * layout bug, and its absence is not the same information as its being empty.
   */
  stages: StageCount[];
  /** Null for Top, which deliberately reports no money. */
  value: BandValue | null;
};

export type ClosedCounts = { won: number; lost: number };

/**
 * Deals decided in each window. The two are evaluated independently and are
 * **not** nested — with a Monday-start week, `weekStart` can precede
 * `monthStart`, so a deal can be counted in `week` and not in `month`.
 */
export type ClosedWindows = { week: ClosedCounts; month: ClosedCounts };

export type PipelineSummary = {
  bands: FunnelBandSummary[];
  closed: ClosedWindows;
  /** Open funnel deals across every band — the total the bands partition. */
  openDeals: number;
};

/** What a fold needs to know about one open deal. */
export type FunnelDeal = {
  status: OpportunityStatus;
  projectId: string | null;
};

/** What a fold needs to know about one project's plan. */
export type ProjectValue = {
  billingType: BillingType | null;
  /** Plan value in the display currency, or null when the plan can't be priced. */
  revenue: number | null;
};

/** What a fold needs to know about one decided deal. */
export type ClosedDeal = {
  status: OpportunityStatus;
  /** The ISO day (`YYYY-MM-DD`) the deal was decided. */
  closedOn: string;
};

// --- Folds -----------------------------------------------------------------

/**
 * Fold open deals into the three bands, pricing Mid and Bottom from their linked
 * projects' plans.
 *
 * **Dedupe is per band.** Several opportunities can share one project (an original
 * deal plus later extensions), so a project reached by two deals in the *same*
 * band contributes its value once. A project reached from two *different* bands
 * counts in each: there is deliberately no org-wide total for that to corrupt, and
 * deciding which band "owns" a shared project is a judgement the data can't
 * support. Don't "fix" this into a global dedupe.
 */
export function summarizeFunnel(
  deals: readonly FunnelDeal[],
  valueByProject: ReadonlyMap<string, ProjectValue>,
): FunnelBandSummary[] {
  return FUNNEL_BANDS.map((band) => {
    const statuses = band.groupIds.flatMap(
      (id) => opportunityGroupById(id).statuses,
    );
    const inBand = deals.filter((d) => bandOfStatus(d.status) === band.id);

    return {
      id: band.id,
      label: band.label,
      deals: inBand.length,
      stages: statuses.map((status) => ({
        status,
        label: STATUS_LABELS[status],
        count: inBand.filter((d) => d.status === status).length,
      })),
      value: band.reportsValue ? bandValue(inBand, valueByProject) : null,
    };
  });
}

function bandValue(
  deals: readonly FunnelDeal[],
  valueByProject: ReadonlyMap<string, ProjectValue>,
): BandValue {
  const counted = new Set<string>();
  let fixedFee: number | null = null;
  let timeAndMaterials: number | null = null;
  let unpricedDeals = 0;

  for (const deal of deals) {
    const plan = deal.projectId
      ? valueByProject.get(deal.projectId)
      : undefined;
    if (!deal.projectId || !plan || plan.revenue === null) {
      unpricedDeals += 1;
      continue;
    }
    // Priced, but this project may already have been counted via a sibling deal.
    if (counted.has(deal.projectId)) continue;
    counted.add(deal.projectId);

    if (plan.billingType === "FIXED_FEE") {
      fixedFee = (fixedFee ?? 0) + plan.revenue;
    } else {
      timeAndMaterials = (timeAndMaterials ?? 0) + plan.revenue;
    }
  }

  return {
    fixedFee,
    timeAndMaterials,
    total:
      fixedFee === null && timeAndMaterials === null
        ? null
        : (fixedFee ?? 0) + (timeAndMaterials ?? 0),
    unpricedDeals,
    pricedProjects: counted.size,
  };
}

/**
 * Count deals decided inside each window. `rows` are expected to be pre-bounded by
 * the read, but the comparisons are total, so a row outside both windows is simply
 * counted in neither — the fold never assumes the SQL bound was exact, which is
 * what lets the read use a deliberately loose one.
 *
 * Non-closed statuses among the rows are ignored rather than counted as wins.
 */
export function summarizeClosed(
  rows: readonly ClosedDeal[],
  weekStart: string,
  monthStart: string,
): ClosedWindows {
  const empty = (): ClosedCounts => ({ won: 0, lost: 0 });
  const closed: ClosedWindows = { week: empty(), month: empty() };

  for (const row of rows) {
    const key =
      row.status === "closed_won"
        ? "won"
        : row.status === "closed_lost"
          ? "lost"
          : null;
    if (key === null) continue;

    // Independent tests, not nested: `weekStart` may precede `monthStart`.
    if (row.closedOn >= weekStart) closed.week[key] += 1;
    if (row.closedOn >= monthStart) closed.month[key] += 1;
  }

  return closed;
}

/** The whole pipeline block for one cohort of deals. */
export function summarizePipeline(
  deals: readonly FunnelDeal[],
  valueByProject: ReadonlyMap<string, ProjectValue>,
  closedRows: readonly ClosedDeal[],
  weekStart: string,
  monthStart: string,
): PipelineSummary {
  const bands = summarizeFunnel(deals, valueByProject);
  return {
    bands,
    closed: summarizeClosed(closedRows, weekStart, monthStart),
    openDeals: bands.reduce((sum, band) => sum + band.deals, 0),
  };
}

// --- Your own deals --------------------------------------------------------

/**
 * One deal you own, as the personal block renders it. Structurally the subset of
 * `MyDealView` this fold needs — declared here rather than imported so the pure
 * module doesn't depend on a `server-only` read.
 */
export type OwnedDeal = {
  status: OpportunityStatus;
  /** The linked project's plan value in the display currency; null = unpriced. */
  value: number | null;
};

export type MyPipelineStage<T extends OwnedDeal = OwnedDeal> = {
  status: OpportunityStatus;
  label: string;
  deals: T[];
  /** Σ over the priced deals; null when none of them is priced. */
  value: number | null;
};

/**
 * Group your own deals by leaf status, in pipeline order, dropping empty stages.
 *
 * Empty stages go here (unlike the org bands, which retain zero rows) because this
 * is a *list* of your work, not a fixed grid: a stage you have nothing in is noise,
 * whereas an org band silently losing a column would read as a layout bug.
 *
 * No dedupe: two of your deals sharing a project each show that project's plan
 * value, matching what each deal's own plan drawer shows. The stage subtotal
 * therefore double-counts a shared project — which is why the UI labels these
 * "project plan value" rather than "deal value".
 */
export function groupMyDealsByStage<T extends OwnedDeal>(
  deals: readonly T[],
): MyPipelineStage<T>[] {
  const stages: MyPipelineStage<T>[] = [];

  for (const status of OPPORTUNITY_STATUSES) {
    if (bandOfStatus(status) === null) continue;
    const inStage = deals.filter((d) => d.status === status);
    if (inStage.length === 0) continue;

    const priced = inStage.filter((d) => d.value !== null);
    stages.push({
      status,
      label: STATUS_LABELS[status],
      deals: inStage,
      value:
        priced.length === 0
          ? null
          : priced.reduce((sum, d) => sum + (d.value ?? 0), 0),
    });
  }

  return stages;
}
