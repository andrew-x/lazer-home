import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { projects } from "@/lib/db/schema";

/**
 * Whether any project is linked to the given opportunity. Used by the
 * status-changing actions to enforce the rule that an opportunity can't advance
 * into delivery stages (Allocating or later, per `requiresProject`) without a
 * project behind it. A single indexed existence check (`projects_opportunity_idx`).
 */
export async function opportunityHasProject(
  opportunityId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.opportunityId, opportunityId))
    .limit(1);

  return rows.length > 0;
}
