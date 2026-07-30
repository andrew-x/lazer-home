/**
 * Bonus payments — the pure, client-importable core (no `db`/drizzle).
 *
 * A bonus is a **payment that happened on a date**, not a term of employment.
 * That is the whole point of this module's existence: bonuses used to live as
 * `staffEmployment.discretionaryBonus`, a column on an effective-dated
 * employment row, which made them read as part of what someone is paid going
 * forward and left nowhere to put a second payment in the same year. They now
 * live in `staffBonusPayment`, keyed only by `paymentDate`.
 *
 * This module owns the type tuple (feeding the `staff_bonus_type` pgEnum, per
 * ADR 0016), its labels, and the write gate — so the schema, the client form,
 * the dashboard and the actions can never drift apart.
 */

import type { PermissionCheck } from "@/lib/auth/permissions";

/**
 * Why a bonus was paid. Ordered roughly by how often we expect to record each.
 *
 * `DISCRETIONARY` and `SPOT` are **not** synonyms, and the distinction is not
 * self-evident from the names — it is the *decision process*, not the amount or
 * the sentiment:
 *
 * - `DISCRETIONARY` was decided in a compensation review cycle. It is what
 *   `compensationPlanItem.plannedBonus` proposes.
 * - `SPOT` was awarded ad-hoc, outside any cycle.
 *
 * Recording one as the other is not a rounding error: it moves spend between
 * "what the review cycle cost us" and "what we handed out in between", which is
 * exactly what the dashboard's by-type breakdown exists to separate.
 */
export const BONUS_TYPES = [
  "DISCRETIONARY",
  "SPOT",
  "INCENTIVE",
  "SIGNING",
  "REFERRAL",
  "GIFT",
] as const;

export type BonusType = (typeof BONUS_TYPES)[number];

export const BONUS_TYPE_LABELS: Record<BonusType, string> = {
  DISCRETIONARY: "Discretionary",
  SPOT: "Spot",
  INCENTIVE: "Incentive",
  SIGNING: "Signing",
  REFERRAL: "Referral",
  GIFT: "Gift",
};

/**
 * One-line explanations for the type picker. The `DISCRETIONARY`/`SPOT` split is
 * unguessable from the labels alone, so the form spells it out at the point of
 * entry rather than trusting whoever records the payment to remember.
 */
export const BONUS_TYPE_DESCRIPTIONS: Record<BonusType, string> = {
  DISCRETIONARY: "Decided in a compensation review cycle",
  SPOT: "Ad-hoc recognition, outside any review cycle",
  INCENTIVE: "Payout for hitting a milestone or target",
  SIGNING: "Paid on joining",
  REFERRAL: "Paid for referring a hire",
  GIFT: "Non-cash — the amount is the cash-equivalent value",
};

/**
 * Non-cash bonus types: the stored `amount` is an **equivalent value**, not money
 * that left a bank account. They still count toward the dashboard's total, which
 * is therefore total *reward spend* rather than cash out the door — the by-type
 * breakdown is what separates the two.
 */
export const NON_CASH_BONUS_TYPES: readonly BonusType[] = ["GIFT"];

/**
 * The gate on recording, editing or deleting a bonus payment.
 *
 * Requires BOTH capabilities, which Better Auth's `authorize` ANDs across
 * resources, so this is a genuine conjunction leaving manager/admin: `finance`
 * holds `viewCompensation` and so reads the dashboard totals, but does not write
 * money records about individuals. Mirrors `COMPENSATION_PLAN_ACCESS`.
 *
 * Defined once here so the three actions and the entry page can never drift. It
 * is a request against the existing matrix, not a new capability —
 * `permissions.ts` remains the only place access-control logic lives.
 */
export const BONUS_PAYMENT_WRITE_ACCESS: PermissionCheck = {
  staff: ["edit", "viewCompensation"],
};

/** Reading a bonus payment is reading compensation — the same gate as the rest of it. */
export const BONUS_PAYMENT_READ_ACCESS: PermissionCheck = {
  staff: ["viewCompensation"],
};

/**
 * The URL search params the two bonus surfaces carry their selected year in: the
 * dashboard section (`bonusYear`, alongside the rest of that page) and the entry
 * screen (`year`, which owns its whole page).
 *
 * These live HERE, in a neutral module, and **must not** move into the client
 * components that render the pickers — even though that is where they are used.
 * A Server Component page has to read `searchParams[thisKey]`, and when a server
 * module imports a value from a `"use client"` module the bundler replaces it with
 * a client-reference proxy rather than the string. The lookup then silently misses
 * and the page reads its default forever: the picker changes the URL and nothing
 * else. That is not a hypothetical — it is the bug this module comment exists to
 * prevent recurring.
 */
export const BONUS_YEAR_PARAM = "bonusYear";
export const BONUS_MANAGER_YEAR_PARAM = "year";
