/**
 * The company's standard hourly bill rates — the rate card a new staffing line is
 * priced from. Keyed by **line of business × project role type**: what we charge for
 * an hour depends both on the practice selling it and on the discipline doing it. A
 * pure, client-importable module (no `db`/drizzle).
 *
 * ── Why one card in code, not one per project ───────────────────────────────
 * A rate card is *policy*: we charge a discipline what we charge it, revised
 * periodically by human judgement rather than negotiated engagement by engagement.
 * Keeping it here means changing a rate needs a code review instead of a migration,
 * it's readable straight from the create dialog, and it's versioned alongside the code
 * that interprets it. Same reasoning as `@/lib/performance/compensation-targets` and
 * the role rubrics (ADR 0042).
 *
 * ── What this card does NOT do any more ─────────────────────────────────────
 * It does **not** price existing plans. Each `project_roles.billRate` is *snapshotted*
 * from this card when the role is created and then stands on its own, so revising a
 * figure below prices **future** roles and deliberately leaves existing ones alone
 * (ADR 0066, reversing ADR 0053's retroactive repricing). Read
 * {@link BILL_RATES_REVIEWED_ON} accordingly: it dates the card that *new* roles are
 * created at, not the card any given plan bills at. `computeProjectMargin` therefore
 * never consults this module — it reads the rate off the row. Reintroducing a card
 * lookup into the margin math would be a bug, not an optimization.
 *
 * ── Shape: `Partial` + a default, not a total map ───────────────────────────
 * Only cells that *deviate* are listed; everything else resolves to
 * {@link DEFAULT_BILL_RATE}. A total map over both keys would be 5 × 6 = 30
 * hand-maintained cells, almost all identical — the same argument that used to keep the
 * form from printing five identical rows, one dimension up.
 *
 * "A role type with no bill rate" is still unrepresentable, but **enforcement moved
 * from the type checker to the `??` inside {@link billRateFor}** — and that cost is
 * real: adding a `LineOfBusiness` or a `ProjectRoleType` no longer breaks the build,
 * it silently prices at the default. (`DELIVERY` was the first instance.) This is only
 * safe because the default is a real price and never a zero. **Nothing but
 * `billRateFor` may read {@link BILL_RATE_EXCEPTIONS}** — indexing it directly puts
 * back the `undefined` case the default exists to eliminate.
 *
 * One currency ({@link BILL_RATE_CURRENCY}) for the whole card, and therefore for every
 * snapshotted rate — the budget summary FX-converts for display.
 *
 * Import note: value imports of `line-of-business` and `project-role-type` are safe
 * here — both are pure tuples that the pgEnums read *from*. Don't copy the
 * `import type`-only caveat in `compensation-targets.ts`; that one is about
 * `staff-enums` reaching back into the schema, which is a different cycle.
 */
import {
  LINE_OF_BUSINESS,
  type LineOfBusiness,
} from "@/lib/crm/line-of-business";
import type { Currency } from "@/lib/format/currency";
import {
  PROJECT_ROLE_TYPES,
  type ProjectRoleType,
} from "@/lib/projects/project-role-type";

/** Every figure below is an hourly amount in this currency. */
export const BILL_RATE_CURRENCY: Currency = "USD";

/**
 * When the card below was last revised. Surfaced in the create dialog so a rate can
 * be read with the right amount of confidence. Bump it when you edit.
 *
 * Because rates are snapshotted per role, this is also the date a reader needs in
 * order to interpret an "off standard rate" role: a role created before this date may
 * simply be carrying the previous price.
 */
export const BILL_RATES_REVIEWED_ON = "2026-08-04";

/**
 * ⚠️ PLACEHOLDER FIGURE — structurally correct but NOT our real rate card. One flat
 * rate across every practice and discipline is a stand-in, not a pricing decision.
 * Replace it (and bump {@link BILL_RATES_REVIEWED_ON}) before anyone reads a project's
 * revenue as authoritative.
 */
export const DEFAULT_BILL_RATE = 250;

/**
 * Cells that deviate from {@link DEFAULT_BILL_RATE}, by line of business then role
 * type. Anything absent bills at the default — so an empty map means "one flat rate".
 *
 * Ships empty deliberately: {@link DEFAULT_BILL_RATE} is a placeholder, and a
 * fabricated exception would read as a pricing decision that nobody made. Add cells
 * as pricing actually decides them, e.g.
 *
 * ```ts
 * export const BILL_RATE_EXCEPTIONS = {
 *   FINTECH: { ARCHITECT: 325, ENGINEER: 285 },
 *   DESIGN: { DESIGNER: 210 },
 * };
 * ```
 *
 * **Use at most 2 decimal places.** A rate is snapshotted into a `numeric(12,2)`
 * column, so `333.333` would store as `333.33` and every role priced from that cell
 * would read as "off standard rate" forever (see {@link isOffStandardRate}).
 */
export const BILL_RATE_EXCEPTIONS: Partial<
  Record<LineOfBusiness, Partial<Record<ProjectRoleType, number>>>
> = {};

/**
 * The standard hourly rate for a discipline in a practice, in
 * {@link BILL_RATE_CURRENCY}. The only sanctioned reader of
 * {@link BILL_RATE_EXCEPTIONS}, and the only way to get a rate out of this module.
 *
 * Takes the role structurally so a `PlanRole`, a form's watched values, or a seed row
 * can all be passed as-is.
 */
export function billRateFor({
  lineOfBusiness,
  roleType,
}: {
  lineOfBusiness: LineOfBusiness;
  roleType: ProjectRoleType;
}): number {
  return BILL_RATE_EXCEPTIONS[lineOfBusiness]?.[roleType] ?? DEFAULT_BILL_RATE;
}

/**
 * Does this role bill at something other than today's standard rate?
 *
 * True both when someone deliberately negotiated a different rate **and** when the
 * card has since moved and this role still carries the old price. That conflation is
 * deliberate: since rates are snapshotted, *stale prices* are the failure mode worth
 * surfacing, and "who typed this" is not actionable while "this bills differently from
 * the current card" is. Hence "off standard rate" rather than "overridden".
 *
 * Compares **rounded cents**, not floats: the stored value has been through a
 * `numeric(12,2)` round trip and would not survive `===` against a card figure.
 */
export function isOffStandardRate({
  lineOfBusiness,
  roleType,
  billRate,
}: {
  lineOfBusiness: LineOfBusiness;
  roleType: ProjectRoleType;
  billRate: number;
}): boolean {
  return (
    Math.round(billRate * 100) !==
    Math.round(billRateFor({ lineOfBusiness, roleType }) * 100)
  );
}

export type RateCardSummary = {
  defaultRate: number;
  currency: Currency;
  /**
   * Only the cells that deviate from the default, in canonical
   * `LINE_OF_BUSINESS` → `PROJECT_ROLE_TYPES` order. Empty ⇒ one flat rate, which lets
   * the UI say so in a line instead of listing 30 identical rows.
   */
  exceptions: {
    lineOfBusiness: LineOfBusiness;
    roleType: ProjectRoleType;
    hourlyRate: number;
  }[];
};

/**
 * The card as the UI shows it: a default plus its exceptions. Derived from
 * {@link BILL_RATE_EXCEPTIONS} rather than listed separately, so a form can never show
 * a rate the card doesn't actually hand out.
 *
 * Built by iterating the canonical tuples rather than `Object.entries`, so the panel
 * reads in the same order every render regardless of how the map was written — the same
 * discipline `convertedFrom` uses in `project-margin.ts`.
 */
export function rateCardSummary(): RateCardSummary {
  const exceptions: RateCardSummary["exceptions"] = [];
  for (const lineOfBusiness of LINE_OF_BUSINESS) {
    for (const roleType of PROJECT_ROLE_TYPES) {
      const hourlyRate = BILL_RATE_EXCEPTIONS[lineOfBusiness]?.[roleType];
      if (hourlyRate !== undefined && hourlyRate !== DEFAULT_BILL_RATE) {
        exceptions.push({ lineOfBusiness, roleType, hourlyRate });
      }
    }
  }
  return {
    defaultRate: DEFAULT_BILL_RATE,
    currency: BILL_RATE_CURRENCY,
    exceptions,
  };
}
