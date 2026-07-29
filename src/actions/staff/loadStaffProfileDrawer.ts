"use server";

import { z } from "zod";
import type { StaffFeedbackView } from "@/actions/feedback/getFeedbackAboutStaff";
import { getFeedbackAboutStaff } from "@/actions/feedback/getFeedbackAboutStaff";
import type { EvaluationHistoryEntry } from "@/actions/performance/getStaffEvaluationHistory";
import { getStaffEvaluationHistory } from "@/actions/performance/getStaffEvaluationHistory";
import type { StaffReviewNotesView } from "@/actions/performance/getStaffReviewNotes";
import { getStaffReviewNotes } from "@/actions/performance/getStaffReviewNotes";
import { canViewCompensation } from "@/actions/staff/canViewCompensation";
import type { HistoryEntry } from "@/actions/staff/getStaffHistory";
import { getStaffHistory } from "@/actions/staff/getStaffHistory";
import { getStaffProfile } from "@/actions/staff/getStaffProfile";
import type { StaffProjectSummary } from "@/actions/staff/getStaffProjects";
import { getStaffProjects } from "@/actions/staff/getStaffProjects";
import type { StaffPtoView } from "@/actions/staff/getStaffPto";
import { getStaffPto } from "@/actions/staff/getStaffPto";
import { ownStaffId } from "@/actions/staff/ownStaffId";
import { secureActionClient } from "@/lib/core/action";
import type { LineOfBusiness } from "@/lib/crm/line-of-business";
import type { Currency } from "@/lib/format/currency";
import { id } from "@/lib/schemas/id-schema";
import type { StaffSkill } from "@/lib/staff/skills";
import type { EmploymentType, Role } from "@/lib/staff/staff-enums";

/**
 * The read-only slice of a profile the drawer shows.
 *
 * **Every sensitive field here is gated at this read, never by the drawer simply
 * not rendering it.** That distinction is the whole reason this type spells out
 * its own shape instead of passing `StaffProfile` through: the profile *pages*
 * can hand a component comp amounts it chooses not to render, because they render
 * server-side; a client-fetched drawer would ship them in its response. So
 * `compensation` is present only for a viewer who may see it, and `pto` only for
 * one who may see that — `null` in both cases means "not permitted", and the
 * drawer renders no section at all.
 */
export type StaffProfileDrawerData = {
  name: string;
  location: string | null;
  joinDate: string | null;
  managerName: string | null;
  clientIntro: string | null;
  skills: StaffSkill[];
  /** Employment facets — no money; that lives on `compensation` behind its gate. */
  employment: {
    role: Role;
    lineOfBusiness: LineOfBusiness;
    employmentType: EmploymentType;
    isBillable: boolean;
  } | null;
  /**
   * Current compensation, or **null when this viewer may not see it** (own comp
   * always; anyone else's needs `staff.viewCompensation`). The amounts never leave
   * the server for an unauthorized caller.
   */
  compensation: {
    base: number | null;
    hourlyRate: number | null;
    guaranteedBonus: number | null;
    discretionaryBonus: number | null;
    currency: Currency | null;
  } | null;
  projects: StaffProjectSummary[];
  /** Null when this viewer may not see this person's PTO (`pto.review`). */
  pto: StaffPtoView | null;
  /** Comp amounts are folded into entries only when the comp gate passed. */
  history: HistoryEntry[];
  /**
   * Rating history. Null when this viewer lacks `ratings.view` — the strictest
   * gate here, and the only one with **no** owner fallback: a staffer never sees
   * their own level (ADR 0032).
   */
  evaluationHistory: EvaluationHistoryEntry[] | null;
  /** Null when this viewer may see no feedback about this person. */
  feedback: StaffFeedbackView | null;
  /** Null when this viewer may see no review notes about this person. */
  reviewNotes: StaffReviewNotesView | null;
};

/**
 * Client-triggered profile load for the staff profile drawer (the interactive-read
 * exception to the server-only read rule — same shape as `loadOpportunityDetail`).
 *
 * **No capability gate**, matching `/staff/[id]`: viewing a colleague's profile is
 * open to any staff member, and the two sensitive slices carry their own gates
 * inside their own reads — `getFeedbackAboutStaff` (`feedback.review`, or the
 * recipient tier for yourself) and `getStaffReviewNotes` (the reporting line).
 * Both return `null` rather than throwing, so the drawer just renders fewer tabs.
 *
 * It does require **an active linked staff row**, not merely a session. That
 * matches the real gate on the page this mirrors: `/staff/[id]` sits behind the
 * `(app)` layout, which admits only linked active staff. Sign-in is Google but
 * *not* domain-restricted, so a session alone can belong to someone who isn't
 * staff at all — the layout bounces them to `/profile-setup`, and an action has to
 * refuse them itself.
 */
export const loadStaffProfileDrawer = secureActionClient
  .metadata({ action: "load-staff-profile-drawer" })
  .inputSchema(z.object({ staffId: id }))
  .action(
    async ({ parsedInput, ctx }): Promise<StaffProfileDrawerData | null> => {
      if (!(await ownStaffId(ctx.user.id, { activeOnly: true }))) return null;

      const [
        profile,
        projects,
        pto,
        feedback,
        reviewNotes,
        evaluationHistory,
        canViewComp,
      ] = await Promise.all([
        getStaffProfile(parsedInput.staffId),
        getStaffProjects(parsedInput.staffId),
        // Self-gating: returns null unless it's the caller's own PTO or they
        // hold `pto.review`.
        getStaffPto(parsedInput.staffId),
        getFeedbackAboutStaff(parsedInput.staffId),
        getStaffReviewNotes(parsedInput.staffId),
        getStaffEvaluationHistory(parsedInput.staffId),
        canViewCompensation(ctx.user, parsedInput.staffId),
      ]);

      if (!profile) return null;

      // Sequential on purpose: the history feed folds comp amounts into its
      // employment entries, so it can't be fetched until the comp gate is known —
      // the same ordering `/staff/[id]` uses.
      const history = await getStaffHistory(parsedInput.staffId, canViewComp);

      const { employment } = profile;

      return {
        name: profile.name,
        location: profile.location,
        joinDate: profile.joinDate,
        managerName: profile.managerName,
        clientIntro: profile.clientIntro,
        skills: profile.skills,
        employment: employment
          ? {
              role: employment.role,
              lineOfBusiness: employment.lineOfBusiness,
              employmentType: employment.employmentType,
              isBillable: employment.isBillable,
            }
          : null,
        compensation:
          canViewComp && employment
            ? {
                base: employment.base,
                hourlyRate: employment.hourlyRate,
                guaranteedBonus: employment.guaranteedBonus,
                discretionaryBonus: employment.discretionaryBonus,
                currency: employment.currency,
              }
            : null,
        projects,
        pto,
        history,
        evaluationHistory,
        feedback,
        reviewNotes,
      };
    },
  );
