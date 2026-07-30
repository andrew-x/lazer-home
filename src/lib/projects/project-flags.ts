/**
 * The risk tags a project carries in the list — "ending soon", "low margin",
 * "negative margin" — and the thresholds that define them. A pure,
 * client-importable module (no `db`/drizzle, no UI) so the read that evaluates the
 * flags (`getProjectsList`) and the card that renders the badges share exactly one
 * definition of the tags, their order, and their labels — the same shape as
 * `@/lib/crm/company-status` and `@/lib/projects/project-derived`.
 *
 * ── Why the thresholds live in code ─────────────────────────────────────────
 * "Thin margin" is *policy*, not per-project data: the number below which an
 * engagement stops being worth doing is a judgement the company revises
 * periodically, and every project must be judged by the same one or two projects
 * could silently disagree about what "healthy" means. Keeping it here means
 * changing a threshold takes a code review instead of a migration, and it's
 * versioned alongside the code that interprets it. Same reasoning as
 * `@/lib/projects/bill-rates` and `@/lib/performance/compensation-targets`
 * (ADR 0042).
 *
 * ── Why the flags are evaluated server-side, in ONE currency ────────────────
 * The list's CAD/USD control is a *display* choice. If the amount threshold were
 * applied to the displayed figure, a project would gain and lose "Low margin" as
 * the reader toggled currency — the tag would describe the rendering rather than
 * the engagement. So flags are always evaluated against the
 * {@link MARGIN_FLAG_CURRENCY} figure, server-side, and never recomputed on the
 * client. The cost: viewing in USD, a card can read "$7,400" and still carry
 * "Low margin" because it is CA$10,100 — under the CAD floor.
 */
import type { DisplayCurrency } from "@/lib/format/currency";
import type { ProjectRoleStatus } from "@/lib/projects/project-role-status";
import { addDays } from "@/lib/timesheets/timesheet-week";

/**
 * When the thresholds below were last revised. Bump it when you edit one, so a tag
 * can be read with the right amount of confidence.
 */
export const PROJECT_FLAGS_REVIEWED_ON = "2026-07-30";

/**
 * How close to its end a project has to be to read as "ending soon", counted from
 * today to the latest end date across its roles.
 */
export const ENDING_SOON_DAYS = 14;

/**
 * Margin at or below this is a *loss*, not merely thin — its own tag, because
 * "we're paying to do this" and "this is tight" call for different conversations.
 * Zero counts: a plan that exactly breaks even earns nothing.
 */
export const NEGATIVE_MARGIN_AT_OR_BELOW = 0;

/**
 * Plan margin is "low" below EITHER of these — a percentage floor and an absolute
 * floor, deliberately OR'd. A big engagement at 15% and a small one at 40% that
 * clears only {@link LOW_MARGIN_AMOUNT} are both worth a second look, and each
 * threshold alone misses one of them.
 */
export const LOW_MARGIN_PERCENT = 0.25;
export const LOW_MARGIN_AMOUNT = 10_000;

/**
 * The currency {@link LOW_MARGIN_AMOUNT} and {@link NEGATIVE_MARGIN_AT_OR_BELOW} are
 * denominated in — and so the currency every margin flag is evaluated in,
 * regardless of what the reader is displaying. See the module header.
 */
export const MARGIN_FLAG_CURRENCY: DisplayCurrency = "CAD";

/**
 * The flags a project can carry, in canonical order: worst first, so the most
 * urgent tag reads first in the badge row.
 */
export const PROJECT_FLAGS = [
  "negativeMargin",
  "lowMargin",
  "endingSoon",
] as const;

export type ProjectFlag = (typeof PROJECT_FLAGS)[number];

/** Human-readable labels for each flag. */
export const PROJECT_FLAG_LABELS: Record<ProjectFlag, string> = {
  negativeMargin: "Negative margin",
  lowMargin: "Low margin",
  endingSoon: "Ending soon",
};

/**
 * Badge variant per flag. Only the loss gets colour — the same convention as
 * `marginAmountTone` and the compensation editor's change columns. A thin margin
 * and an approaching end date are things to notice, not failures, so they read as
 * neutral tags.
 */
export const PROJECT_FLAG_VARIANTS: Record<
  ProjectFlag,
  "destructive" | "secondary"
> = {
  negativeMargin: "destructive",
  lowMargin: "secondary",
  endingSoon: "secondary",
};

/** The margin figures a flag decision needs, in {@link MARGIN_FLAG_CURRENCY}. */
export type ProjectFlagMargin = {
  margin: number | null;
  marginPercent: number | null;
};

export type ProjectFlagInputs = {
  /** The project's derived status (see `project-derived.ts`). */
  status: ProjectRoleStatus;
  /** Latest role end date ("YYYY-MM-DD"); null when the project has no roles. */
  endDate: string | null;
  /** Today, as "YYYY-MM-DD" — passed in so the caller reads the clock once. */
  today: string;
  /**
   * Plan margin in {@link MARGIN_FLAG_CURRENCY}, or **null** when the viewer lacks
   * `projects.viewMargin`. Null yields no margin flags at all: the absence of a tag
   * must not become a channel for the figure itself.
   */
  margin: ProjectFlagMargin | null;
};

const TAG_PREDICATES: Record<
  ProjectFlag,
  (input: ProjectFlagInputs) => boolean
> = {
  negativeMargin: (input) =>
    isLive(input) &&
    input.margin?.margin != null &&
    input.margin.margin <= NEGATIVE_MARGIN_AT_OR_BELOW,

  lowMargin: (input) => {
    if (!isLive(input) || input.margin?.margin == null) return false;
    // A loss is strictly worse and carries its own tag; showing both is noise.
    if (input.margin.margin <= NEGATIVE_MARGIN_AT_OR_BELOW) return false;
    const { margin, marginPercent } = input.margin;
    return (
      (marginPercent != null && marginPercent < LOW_MARGIN_PERCENT) ||
      margin < LOW_MARGIN_AMOUNT
    );
  },

  endingSoon: (input) => {
    if (!isLive(input) || input.endDate == null) return false;
    // "YYYY-MM-DD" is zero-padded, so lexicographic order === chronological.
    return (
      input.endDate >= input.today &&
      input.endDate <= addDays(input.today, ENDING_SOON_DAYS)
    );
  },
};

/**
 * Is there anything left to flag? A cancelled project will never be delivered or
 * billed, so neither its plan margin nor its end date is a fact about work anyone
 * still has to do.
 */
function isLive(input: ProjectFlagInputs): boolean {
  return input.status !== "cancelled";
}

/**
 * The flags that apply to a project, in canonical order. Returns an empty array
 * when none do — including whenever margin is unknown (no budget set, or no cost
 * basis for any role): "we can't tell" is not "it's bad".
 */
export function projectFlags(input: ProjectFlagInputs): ProjectFlag[] {
  return PROJECT_FLAGS.filter((flag) => TAG_PREDICATES[flag](input));
}
