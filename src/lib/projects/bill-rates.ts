/**
 * The company's standard hourly bill rates per project role type — the rate card
 * every time-and-materials project bills at. A pure, client-importable module (no
 * `db`/drizzle).
 *
 * ── Why one card in code, not one per project ───────────────────────────────
 * A rate card is *policy*: we charge a discipline what we charge it, revised
 * periodically by human judgement rather than negotiated engagement by engagement.
 * Keeping it here means changing a rate needs a code review instead of a migration,
 * it's readable straight from the create dialog, it's versioned alongside the code
 * that interprets it, and — the load-bearing part — every T&M project prices the same
 * way, so two projects can't silently disagree about what an engineer-hour is worth.
 * Same reasoning as `@/lib/performance/compensation-targets` and the role rubrics
 * (ADR 0042).
 *
 * A per-project rate card was built first and removed; see
 * docs/decisions/0053-project-budgets-and-margin.md for why. If per-project pricing
 * is ever genuinely needed, that's a schema decision to reopen deliberately, not a
 * field to add to this map.
 *
 * ── Shape ───────────────────────────────────────────────────────────────────
 * TOTAL, not `Partial`: every role type must have a rate, so a T&M plan can never
 * contain a role it doesn't know how to bill. One currency
 * ({@link BILL_RATE_CURRENCY}) for the whole card — the budget summary FX-converts
 * for display.
 */
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
 */
export const BILL_RATES_REVIEWED_ON = "2026-07-29";

/**
 * ⚠️ PLACEHOLDER FIGURES — structurally correct but NOT our real rate card. One flat
 * rate across every discipline is a stand-in, not a pricing decision. Replace these
 * (and bump {@link BILL_RATES_REVIEWED_ON}) before anyone reads a project's revenue
 * as authoritative.
 */
const FLAT_PLACEHOLDER_RATE = 225;

export const BILL_RATES: Record<ProjectRoleType, number> = {
  ENGINEER: FLAT_PLACEHOLDER_RATE,
  DESIGNER: FLAT_PLACEHOLDER_RATE,
  ARCHITECT: FLAT_PLACEHOLDER_RATE,
  QA: FLAT_PLACEHOLDER_RATE,
  SPECIALIST: FLAT_PLACEHOLDER_RATE,
};

/**
 * The card as rows in canonical `PROJECT_ROLE_TYPES` order, for display. Derived from
 * {@link BILL_RATES} rather than listed separately, so the form can never show a rate
 * the margin math doesn't use.
 */
export function standardRateCard(): {
  roleType: ProjectRoleType;
  hourlyRate: number;
  currency: Currency;
}[] {
  return PROJECT_ROLE_TYPES.map((roleType) => ({
    roleType,
    hourlyRate: BILL_RATES[roleType],
    currency: BILL_RATE_CURRENCY,
  }));
}

/** True when every discipline bills the same — lets the UI say so in one line. */
export function isFlatRateCard(): boolean {
  return new Set(Object.values(BILL_RATES)).size === 1;
}
