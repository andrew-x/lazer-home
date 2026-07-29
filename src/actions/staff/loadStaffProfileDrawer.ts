"use server";

import { z } from "zod";
import type { StaffFeedbackView } from "@/actions/feedback/getFeedbackAboutStaff";
import { getFeedbackAboutStaff } from "@/actions/feedback/getFeedbackAboutStaff";
import type { StaffReviewNotesView } from "@/actions/performance/getStaffReviewNotes";
import { getStaffReviewNotes } from "@/actions/performance/getStaffReviewNotes";
import { getStaffProfile } from "@/actions/staff/getStaffProfile";
import type { StaffProjectSummary } from "@/actions/staff/getStaffProjects";
import { getStaffProjects } from "@/actions/staff/getStaffProjects";
import { ownStaffId } from "@/actions/staff/ownStaffId";
import { secureActionClient } from "@/lib/core/action";
import type { LineOfBusiness } from "@/lib/crm/line-of-business";
import { id } from "@/lib/schemas/id-schema";
import type { StaffSkill } from "@/lib/staff/skills";
import type { EmploymentType, Role } from "@/lib/staff/staff-enums";

/**
 * The read-only slice of a profile the drawer shows.
 *
 * Deliberately **no compensation and no PTO.** `getStaffProfile` carries comp
 * amounts inline on `employment`, and the profile *pages* only get away with that
 * because they render server-side — a client-fetched drawer would ship them in
 * its response whether or not it renders them. So this projects the employment
 * row down to its facets. (The compensation-plan row the drawer opens from
 * already shows the money it needs, under the plan's own stricter gate.)
 */
export type StaffProfileDrawerData = {
  name: string;
  email: string;
  location: string | null;
  joinDate: string | null;
  managerName: string | null;
  clientIntro: string | null;
  skills: StaffSkill[];
  employment: {
    role: Role;
    lineOfBusiness: LineOfBusiness;
    employmentType: EmploymentType;
    isBillable: boolean;
  } | null;
  projects: StaffProjectSummary[];
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

      const [profile, projects, feedback, reviewNotes] = await Promise.all([
        getStaffProfile(parsedInput.staffId),
        getStaffProjects(parsedInput.staffId),
        getFeedbackAboutStaff(parsedInput.staffId),
        getStaffReviewNotes(parsedInput.staffId),
      ]);

      if (!profile) return null;

      return {
        name: profile.name,
        email: profile.email,
        location: profile.location,
        joinDate: profile.joinDate,
        managerName: profile.managerName,
        clientIntro: profile.clientIntro,
        skills: profile.skills,
        employment: profile.employment
          ? {
              role: profile.employment.role,
              lineOfBusiness: profile.employment.lineOfBusiness,
              employmentType: profile.employment.employmentType,
              isBillable: profile.employment.isBillable,
            }
          : null,
        projects,
        feedback,
        reviewNotes,
      };
    },
  );
