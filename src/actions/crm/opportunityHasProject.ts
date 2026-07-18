import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { opportunities } from "@/lib/db/schema";

/**
 * Whether the given opportunity has an associated project. Used by the
 * status-changing actions to enforce the rule that an opportunity can't advance
 * into delivery stages (Allocating or later, per `requiresProject`) without a
 * project behind it. A single indexed lookup of the opportunity's own
 * `projectId` (the CRM → delivery link now lives on `opportunities`).
 */
export async function opportunityHasProject(
  opportunityId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ projectId: opportunities.projectId })
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId))
    .limit(1);

  return row?.projectId != null;
}
