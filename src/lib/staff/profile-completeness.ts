import type { PermissionCheck } from "@/lib/auth/permissions";
import {
  MANUAL_OF_ME_QUESTION_IDS,
  MANUAL_OF_ME_SHORT_LABELS,
} from "@/lib/staff/manual-of-me";
import {
  WAYS_OF_WORKING_QUESTION_IDS,
  WOW_SECTIONS,
} from "@/lib/staff/ways-of-working";

/**
 * Shared constants for the profile-completeness table (`/reporting/profile-completeness`).
 *
 * A pure, client-importable module (no `db`/drizzle, no `server-only`): the read
 * is server-only but the table is a client component, so the denominators it
 * renders have nowhere else to come from. Same discipline as
 * `@/lib/staff/staff-filters`.
 */

/**
 * Who may see who has and hasn't filled out their profile.
 *
 * Chasing profile completion is the job of the people who may edit those
 * profiles, so this reuses the existing `staff.edit` capability
 * (manager/admin) rather than inventing one — it is a request against the
 * existing matrix, and `permissions.ts` stays the only place access-control
 * logic lives. Nothing sensitive is exposed either way: the read carries
 * presence and counts, never profile content.
 *
 * Defined once here so the route, the nav entry and the read can't drift.
 * Mirrors `BONUS_PAYMENT_WRITE_ACCESS` / `COMPENSATION_PLAN_ACCESS`.
 */
export const PROFILE_COMPLETENESS_ACCESS: PermissionCheck = {
  staff: ["edit"],
};

/**
 * The denominators the table renders against. Sourced from the survey id tuples
 * rather than hardcoded, so adding a Ways of Working question moves "14 of 30"
 * here without a second edit.
 *
 * `links` is the one literal — LinkedIn, GitHub and portfolio are three named
 * columns on `staff`, not a list.
 */
export const PROFILE_COMPLETENESS_TOTALS = {
  links: 3,
  manualOfMe: MANUAL_OF_ME_QUESTION_IDS.length,
  waysOfWorking: WAYS_OF_WORKING_QUESTION_IDS.length,
} as const;

/**
 * One line of a partial-completion tooltip: what the piece is, and how much of
 * it is done.
 *
 * `total` of 1 means an all-or-nothing field (a single profile link, one survey
 * question) and renders as a tick or a dash; anything higher is a group and
 * renders as "2 of 6". One shape covers all three breakdowns so the tooltip has
 * a single renderer.
 */
export type CompletenessBreakdownItem = {
  label: string;
  done: number;
  total: number;
};

/** The three profile links, in the order the profile's Links card shows them. */
export function linksBreakdown(row: {
  hasLinkedin: boolean;
  hasGithub: boolean;
  hasPortfolio: boolean;
}): CompletenessBreakdownItem[] {
  return [
    { label: "LinkedIn", done: row.hasLinkedin ? 1 : 0, total: 1 },
    { label: "GitHub", done: row.hasGithub ? 1 : 0, total: 1 },
    { label: "Portfolio", done: row.hasPortfolio ? 1 : 0, total: 1 },
  ];
}

/** All seven Manual of Me prompts, by their short names, in canonical order. */
export function manualOfMeBreakdown(
  answered: ReadonlySet<string>,
): CompletenessBreakdownItem[] {
  return MANUAL_OF_ME_QUESTION_IDS.map((id) => ({
    label: MANUAL_OF_ME_SHORT_LABELS[id],
    done: answered.has(id) ? 1 : 0,
    total: 1,
  }));
}

/**
 * Ways of Working broken down **by section, not by question** — thirty rows
 * would overflow a tooltip and wouldn't tell anyone what to go and finish. The
 * section list is derived from `WOW_SECTIONS`, so a new section appears here
 * automatically.
 *
 * A matrix section contributes its six usage/savings tier ids (the same six the
 * 30-question total counts), so the fractions here sum to the column's value.
 */
export function waysOfWorkingBreakdown(
  answered: ReadonlySet<string>,
): CompletenessBreakdownItem[] {
  return WOW_SECTIONS.map((section) => {
    const questionIds =
      section.kind === "matrix"
        ? [
            section.usage.critical,
            section.usage.common,
            section.usage.avoid,
            section.savings.major,
            section.savings.minor,
            section.savings.no,
          ]
        : section.fields.map((field) => field.questionId);

    return {
      label: section.title,
      done: questionIds.filter((id) => answered.has(id)).length,
      total: questionIds.length,
    };
  });
}
