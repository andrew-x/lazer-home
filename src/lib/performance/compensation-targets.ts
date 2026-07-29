/**
 * Intended compensation per role × delivery pool × level. A pure,
 * client-importable module (no `db`/drizzle).
 *
 * A compensation proposal is only judgeable against what we *intend* to pay
 * someone at that level — an L2 Hub Engineer has a number we're aiming at, and the
 * gap between it and a proposal is the thing a comp round is actually deciding.
 * That number lived only in people's heads; this is it.
 *
 * ── Why code and not a table ────────────────────────────────────────────────
 * A target is *policy*, revised periodically by human judgement — not a
 * per-person fact. Keeping it here means changing one needs a code review rather
 * than a migration, it is readable straight from a client component, and it is
 * versioned alongside the code that interprets it. Same reasoning as the
 * role rubrics in `@/lib/performance/rating-rubric` (ADR 0042).
 *
 * ── Shape ───────────────────────────────────────────────────────────────────
 * Keyed role → billable type → level, because the intended number for an L1
 * Engineer differs sharply between the Hub and the Global pool. Stored as ONE
 * annual figure in ONE currency ({@link COMP_TARGET_CURRENCY}); callers FX- and
 * unit-convert for display, so there is no per-currency table to keep in step.
 *
 * The outer map is `Partial` by role: a role with no table is a first-class "no
 * target", and the editor renders an em dash rather than inventing a zero. The
 * inner two dimensions are total — once you configure a role you must state both
 * pools and all five levels, each explicitly a number or `null`. The type checker
 * enforces that, so there is nothing left for a test to assert. Monotonicity is
 * deliberately NOT enforced: a flat band across two adjacent levels is a
 * legitimate policy choice.
 */

// Keep every one of these `import type`. `compensation-plan` imports this module
// for values, and the schema imports `compensation-plan` — so a VALUE import from
// `staff-enums` (which reads the pgEnums out of `@/lib/db/schema`) would close a
// runtime cycle through the schema. Types are erased, so these are free.
import type { Currency } from "@/lib/format/currency";
import type { CompUnit } from "@/lib/performance/compensation-unit";
import type { BillableType, Role } from "@/lib/staff/staff-enums";
import type { RatingLevel } from "@/lib/staff/staff-rating";

/** Every figure below is an annual amount in this currency. */
export const COMP_TARGET_CURRENCY: Currency = "CAD";

/** Every figure below is denominated in this unit. */
export const COMP_TARGET_UNIT: CompUnit = "ANNUAL";

/**
 * When the table below was last revised. Surfaced in the editor's tooltip so a
 * gap can be read with the right amount of confidence. Bump it when you edit.
 */
export const COMP_TARGETS_REVIEWED_ON = "2026-07-28";

/** One annual figure per level. `null` = no target defined at this level. */
export type LevelTargets = Readonly<Record<RatingLevel, number | null>>;

export type RoleTargets = Readonly<Record<BillableType, LevelTargets>>;

/**
 * ⚠️ PLACEHOLDER FIGURES — these are structurally correct but NOT our real bands.
 * They exist so the gap columns can be exercised end to end. Replace them with the
 * agreed numbers (and bump {@link COMP_TARGETS_REVIEWED_ON}) before anyone reads a
 * gap as authoritative.
 */
export const COMP_TARGETS: Partial<Record<Role, RoleTargets>> = {
  ENGINEER: {
    HUB: { 0: 75_000, 1: 95_000, 2: 120_000, 3: 150_000, 4: 185_000 },
    GLOBAL: { 0: 30_000, 1: 42_000, 2: 58_000, 3: 76_000, 4: 95_000 },
  },
};

/**
 * The intended annual {@link COMP_TARGET_CURRENCY} figure for a person, or `null`
 * when there is nothing to compare against — an unrated level, a role with no
 * table, or a level left explicitly undefined. Never a zero: "no target" and "a
 * target of nothing" are different claims.
 */
export function compTargetAnnual({
  role,
  billableType,
  level,
}: {
  role: Role | null;
  billableType: BillableType | null;
  level: number | null;
}): number | null {
  if (!role || !billableType || level == null) return null;
  return COMP_TARGETS[role]?.[billableType]?.[level as RatingLevel] ?? null;
}
