import "server-only";

import { and, eq } from "drizzle-orm";
import type { db } from "@/lib/db/db";
import { projectRoles } from "@/lib/db/schema";
import type { OpportunityStatus } from "@/lib/opportunity";

/** `db` or a transaction handle — both expose the `.update` used below. */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * When an opportunity is won, its tentative roles are locked in: flip every
 * `tentative` role tagged with this opportunity to `confirmed`. A no-op unless
 * the status is actually *changing into* `closed_won` (so re-saving an
 * already-won deal doesn't touch roles). Run inside the same transaction as the
 * status write so the status change and the role flip commit atomically. See
 * docs/domains/projects.md.
 */
export async function confirmRolesOnWon(
  exec: Executor,
  opportunityId: string,
  nextStatus: OpportunityStatus,
  prevStatus: OpportunityStatus,
): Promise<void> {
  if (nextStatus !== "closed_won" || prevStatus === "closed_won") return;

  await exec
    .update(projectRoles)
    .set({ status: "confirmed" })
    .where(
      and(
        eq(projectRoles.opportunityId, opportunityId),
        eq(projectRoles.status, "tentative"),
      ),
    );
}
