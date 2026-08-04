import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { db } from "@/lib/db/db";
import { projectRoles, staff, staffPto } from "@/lib/db/schema";
import { formatIsoDate } from "@/lib/format/format";
import { countWorkingDays } from "@/lib/staff/pto-working-days";
import type { PtoType } from "@/lib/staff/staff-enums";

/**
 * One person's leave span on the project PTO tab. `type`/`isPending` carry the
 * *kind* of leave and are only populated for viewers who may review PTO — for
 * everyone else they're masked (null/false), so a viewer sees **who is away and
 * when** but not why.
 */
export type ProjectPtoSpan = {
  id: string;
  staffId: string;
  staffName: string;
  startDate: string;
  endDate: string;
  workingDays: number;
  isPending: boolean;
  /** The leave kind, or null when the viewer may not see it. */
  type: PtoType | null;
};

export type ProjectPtoView = {
  /** Not yet ended (endDate >= today), soonest first. */
  upcoming: ProjectPtoSpan[];
  /** Already ended (endDate < today), most recent first. */
  past: ProjectPtoSpan[];
  /** Whether the viewer may see the leave type (the `pto.review` permission). */
  canSeeType: boolean;
};

/**
 * Time off for everyone connected to a project — its staffed people, i.e. every
 * role with an assignee, delivery managers included — split into upcoming and past.
 *
 * Visibility: the tab is open to anyone who can view the project, so every
 * viewer sees the person, dates, and working-day count. The **leave type** (and
 * pending state) is sensitive and gated on `pto.review`: without it, `type` is
 * null and `isPending` false. Masking happens here in the read, never in the
 * client. Reads go through the actions layer.
 *
 * Reviewers (`pto.review`) additionally see leave that is still **pending**, so
 * they can plan around requests before approval. Everyone else gets approved
 * leave only — matching the allocations grid, and deliberate: a masked pending
 * span would otherwise be indistinguishable from an approved one, presenting an
 * unapproved (possibly to-be-rejected) request as settled.
 */
export async function getProjectPto(
  projectId: string,
): Promise<ProjectPtoView> {
  const user = await getCurrentUser();
  // Fail closed: no session ⇒ no leave data at all. In practice the `(app)`
  // layout redirects first, but the read scopes itself rather than relying on it.
  if (!user) return { upcoming: [], past: [], canSeeType: false };
  const canSeeType = userHasPermission(user, { pto: ["review"] });

  // The project's people: the assignees on its roles. That now includes its
  // delivery managers, who hold `DELIVERY` roles like anyone else — this used to
  // union in a second query over `project_delivery_managers` (ADR 0067).
  const roleStaffRows = await db
    .selectDistinct({ staffId: projectRoles.staffId })
    .from(projectRoles)
    .where(eq(projectRoles.projectId, projectId));

  const staffIds = roleStaffRows.flatMap((r) => (r.staffId ? [r.staffId] : []));

  if (staffIds.length === 0) {
    return { upcoming: [], past: [], canSeeType };
  }

  const rows = await db
    .select({
      id: staffPto.id,
      staffId: staffPto.staffId,
      staffName: staff.name,
      startDate: staffPto.startDate,
      endDate: staffPto.endDate,
      type: staffPto.type,
      isPending: staffPto.isPending,
    })
    .from(staffPto)
    .innerJoin(staff, eq(staffPto.staffId, staff.id))
    .where(
      canSeeType
        ? inArray(staffPto.staffId, staffIds)
        : // Approved leave only for non-reviewers — see the note above.
          and(
            inArray(staffPto.staffId, staffIds),
            eq(staffPto.isPending, false),
          ),
    );

  const today = formatIsoDate(new Date());
  const upcoming: ProjectPtoSpan[] = [];
  const past: ProjectPtoSpan[] = [];

  for (const row of rows) {
    const span: ProjectPtoSpan = {
      id: row.id,
      staffId: row.staffId,
      staffName: row.staffName,
      startDate: row.startDate,
      endDate: row.endDate,
      workingDays: countWorkingDays(row.startDate, row.endDate),
      // Mask the sensitive fields unless the viewer may review PTO. `false` is
      // now truthful for non-reviewers — the query filtered pending rows out.
      isPending: canSeeType ? row.isPending : false,
      type: canSeeType ? row.type : null,
    };
    if (row.endDate >= today) upcoming.push(span);
    else past.push(span);
  }

  // Upcoming soonest-first; past most-recent-first. Tie-break by person.
  upcoming.sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) ||
      a.staffName.localeCompare(b.staffName),
  );
  past.sort(
    (a, b) =>
      b.endDate.localeCompare(a.endDate) ||
      a.staffName.localeCompare(b.staffName),
  );

  return { upcoming, past, canSeeType };
}
