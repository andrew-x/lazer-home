import "server-only";

import { asc, inArray, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getCurrentUser } from "@/lib/auth/auth";
import { requirePermission } from "@/lib/auth/permissions";
import { firstPerKey } from "@/lib/core/collections";
import { db } from "@/lib/db/db";
import {
  responses,
  type StaffEmployment,
  staff,
  staffEmployment,
} from "@/lib/db/schema";
import { MANUAL_OF_ME_QUESTION_IDS } from "@/lib/staff/manual-of-me";
import { PROFILE_COMPLETENESS_ACCESS } from "@/lib/staff/profile-completeness";
import { latestEmploymentFirst } from "@/lib/staff/staff-employment";
import { isResponseAnswered } from "@/lib/staff/survey-answers";
import { WAYS_OF_WORKING_QUESTION_IDS } from "@/lib/staff/ways-of-working";

/**
 * One staff member's profile-completeness picture: which of the self-service
 * profile artefacts they've filled in, and when the two dated ones last changed.
 *
 * Deliberately carries NO profile content — only presence, counts and dates. The
 * résumé and client intro are free text a manager chasing completion has no need
 * to receive, so the presence booleans are computed in SQL rather than by
 * shipping the strings and testing them here (the same "minimise in the
 * projection, never in the JSX" discipline as `loadStaffProfileDrawer`).
 *
 * Employment fields are null when a staff row has no employment history (still
 * listed). Inactive staff are included so the "show inactive" toggle stays a UI
 * concern, matching `getStaffDirectory`.
 */
export type ProfileCompletenessRow = {
  id: string;
  name: string;
  isActive: boolean;
  lineOfBusiness: StaffEmployment["lineOfBusiness"] | null;
  role: StaffEmployment["role"] | null;
  employmentType: StaffEmployment["employmentType"] | null;
  // The three profile links individually, so a partially-filled cell can say
  // *which* one is missing rather than only "2 of 3". Presence, never the URL.
  hasLinkedin: boolean;
  hasGithub: boolean;
  hasPortfolio: boolean;
  hasResume: boolean;
  skillCount: number;
  skillsUpdatedAt: Date | null;
  hasClientIntro: boolean;
  clientIntroUpdatedAt: Date | null;
  /**
   * Which survey questions have an answer — the ids only, never the answers.
   * The counts the table sorts on are these arrays' lengths, so there is one
   * source of truth, and the per-section tooltip breakdown is derivable client
   * side from `WOW_SECTIONS` without a second read.
   *
   * Question ids are not sensitive here: the surveys themselves are readable by
   * any signed-in viewer (`getManualOfMe` / `getWaysOfWorking` are not
   * ownership-scoped), so knowing *that* a question was answered discloses
   * strictly less than the existing profile surfaces already do — and this read
   * is manager/admin-only on top.
   */
  manualOfMeAnsweredIds: string[];
  waysOfWorkingAnsweredIds: string[];
};

/** "This text column holds something a person actually typed" — null and
 * whitespace-only both count as empty. */
function filled(column: AnyPgColumn) {
  return sql<boolean>`(${column} is not null and btrim(${column}) <> '')`;
}

/**
 * Profile completeness across every staff member, for the People-management
 * table at `/reporting/profile-completeness`.
 *
 * Gated on `staff.edit` (manager/admin) in its own right, not just by the route:
 * an action has no layout above it, and this is a cross-person management view.
 * No new capability — the RBAC matrix is unchanged.
 */
export async function getProfileCompleteness(): Promise<
  ProfileCompletenessRow[]
> {
  const user = await getCurrentUser();
  requirePermission(user ?? { role: null }, PROFILE_COMPLETENESS_ACCESS);

  const staffRows = await db
    .select({
      id: staff.id,
      name: staff.name,
      isActive: staff.isActive,
      // Presence per link, resolved in SQL so the URLs themselves never leave
      // the database — the table renders "2 of 3" and names the missing one.
      hasLinkedin: filled(staff.linkedinUrl),
      hasGithub: filled(staff.githubUrl),
      hasPortfolio: filled(staff.portfolioUrl),
      hasResume: filled(staff.resume),
      // `skills` is NOT NULL default '[]', so this is always a number.
      skillCount: sql<number>`jsonb_array_length(${staff.skills})`,
      skillsUpdatedAt: staff.skillsUpdatedAt,
      hasClientIntro: filled(staff.clientIntro),
      clientIntroUpdatedAt: staff.clientIntroUpdatedAt,
    })
    .from(staff)
    .orderBy(asc(staff.name));

  // Same two-query, latest-per-staff shape as `getStaffDirectory` — reads every
  // employment row and reduces in JS rather than issuing one query per person.
  // The ordering is the shared effective-dating fragment, never re-derived.
  const employmentRows = await db
    .select({
      staffId: staffEmployment.staffId,
      lineOfBusiness: staffEmployment.lineOfBusiness,
      role: staffEmployment.role,
      employmentType: staffEmployment.employmentType,
    })
    .from(staffEmployment)
    .orderBy(...latestEmploymentFirst);

  const latestByStaff = firstPerKey(employmentRows, (row) => row.staffId);

  // Both surveys in one pass. Scans the survey slice of `responses` (staff ×
  // ~37 questions — trivial at company scale); if it ever grows, aggregate with
  // a GROUP BY instead. Counting here rather than in SQL keeps ONE definition of
  // "answered" (`isResponseAnswered`) shared with the per-person survey reads.
  const responseRows = await db
    .select({
      staffId: responses.staffId,
      questionId: responses.questionId,
      textResponse: responses.textResponse,
      listResponse: responses.listResponse,
    })
    .from(responses)
    .where(
      inArray(responses.questionId, [
        ...MANUAL_OF_ME_QUESTION_IDS,
        ...WAYS_OF_WORKING_QUESTION_IDS,
      ]),
    );

  const manualOfMeIds = new Set<string>(MANUAL_OF_ME_QUESTION_IDS);
  const answeredByStaff = new Map<
    string,
    { manualOfMe: string[]; waysOfWorking: string[] }
  >();
  for (const row of responseRows) {
    if (!isResponseAnswered(row)) continue;
    const answered = answeredByStaff.get(row.staffId) ?? {
      manualOfMe: [],
      waysOfWorking: [],
    };
    if (manualOfMeIds.has(row.questionId)) {
      answered.manualOfMe.push(row.questionId);
    } else {
      answered.waysOfWorking.push(row.questionId);
    }
    answeredByStaff.set(row.staffId, answered);
  }

  return staffRows.map((s) => {
    const employment = latestByStaff.get(s.id);
    const answered = answeredByStaff.get(s.id);
    return {
      id: s.id,
      name: s.name,
      isActive: s.isActive,
      lineOfBusiness: employment?.lineOfBusiness ?? null,
      role: employment?.role ?? null,
      employmentType: employment?.employmentType ?? null,
      hasLinkedin: s.hasLinkedin,
      hasGithub: s.hasGithub,
      hasPortfolio: s.hasPortfolio,
      hasResume: s.hasResume,
      // `jsonb_array_length` returns int4, which node-pg parses to a JS number
      // (verified against the real DB) — no coercion needed here.
      skillCount: s.skillCount,
      skillsUpdatedAt: s.skillsUpdatedAt,
      hasClientIntro: s.hasClientIntro,
      clientIntroUpdatedAt: s.clientIntroUpdatedAt,
      manualOfMeAnsweredIds: answered?.manualOfMe ?? [],
      waysOfWorkingAnsweredIds: answered?.waysOfWorking ?? [],
    };
  });
}
