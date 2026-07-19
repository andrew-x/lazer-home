import "server-only";

import { and, count, eq, isNull, ne } from "drizzle-orm";
import type { db } from "@/lib/db/db";
import { opportunities, projectRoles, projects } from "@/lib/db/schema";

/** `db` or a transaction handle. */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Detach a project from one opportunity, cleaning up appropriately. Shared by
 * the planner's "Remove project" action and `deleteOpportunity` (which calls
 * this before deleting the opportunity row, so provenance is still intact).
 *
 * A project can be shared by several opportunities (an original deal plus later
 * expansions). So:
 *
 * - **Sole owner** — every role on the project belongs to this opportunity AND
 *   no *other* opportunity is linked to it → delete the whole project (cascades
 *   its roles and delivery managers). This opportunity's `projectId` is nulled
 *   first so the FK `restrict` on `opportunities.projectId` doesn't block it.
 * - **Otherwise** — the project is shared or holds roles from elsewhere → delete
 *   only *this* opportunity's roles and unlink it, leaving the project (and the
 *   other opportunities' roles) intact.
 *
 * This is a bulk detach, so it intentionally bypasses `assertRoleEditable`
 * (which guards single-role *user* edits): removing a project's own roles is not
 * subject to the tentative-only rule. Must run inside the caller's transaction.
 * Returns whether the project was deleted.
 */
export async function detachProjectFromOpportunity(
  tx: Executor,
  { opportunityId, projectId }: { opportunityId: string; projectId: string },
): Promise<{ deletedProject: boolean }> {
  // Are there any roles on this project that DON'T belong to this opportunity
  // (a different opportunity, or an unassigned/standalone role)?
  const [otherRoles] = await tx
    .select({ n: count() })
    .from(projectRoles)
    .where(
      and(
        eq(projectRoles.projectId, projectId),
        ne(projectRoles.opportunityId, opportunityId),
      ),
    );

  // Is any OTHER opportunity linked to this same project?
  const [otherOpps] = await tx
    .select({ n: count() })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.projectId, projectId),
        ne(opportunities.id, opportunityId),
      ),
    );

  // `ne(opportunityId, ...)` excludes NULLs in SQL, so unassigned roles aren't
  // counted above — fold them in explicitly: an unassigned role is "not from
  // this opportunity" and must keep the project alive.
  const [unassignedRoles] = await tx
    .select({ n: count() })
    .from(projectRoles)
    .where(
      and(
        eq(projectRoles.projectId, projectId),
        isNull(projectRoles.opportunityId),
      ),
    );

  const soleOwner =
    otherRoles.n === 0 && unassignedRoles.n === 0 && otherOpps.n === 0;

  if (soleOwner) {
    // Release the FK restrict, then drop the project (roles + DMs cascade).
    await tx
      .update(opportunities)
      .set({ projectId: null })
      .where(eq(opportunities.id, opportunityId));
    await tx.delete(projects).where(eq(projects.id, projectId));
    return { deletedProject: true };
  }

  // Shared or mixed-ownership: remove just this opportunity's roles and unlink.
  await tx
    .delete(projectRoles)
    .where(
      and(
        eq(projectRoles.projectId, projectId),
        eq(projectRoles.opportunityId, opportunityId),
      ),
    );
  await tx
    .update(opportunities)
    .set({ projectId: null })
    .where(eq(opportunities.id, opportunityId));
  return { deletedProject: false };
}
