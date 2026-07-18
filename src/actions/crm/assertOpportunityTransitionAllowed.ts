import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { opportunities } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import type { OpportunityStatus } from "@/lib/opportunity";
import { requiresProject } from "@/lib/opportunity-pipeline";
import { opportunityHasProject } from "./opportunityHasProject";

/**
 * The single enforcement of ADR 0024's delivery-stage invariant: an opportunity
 * can't advance into a stage that `requiresProject` (Allocating onward, Closed –
 * Lost excepted) without a linked project. Shared by every status-mutating
 * action (`updateOpportunity`, `updateOpportunityPosition`, and the field-scoped
 * `updateOpportunityField`) so the rule has exactly one implementation.
 *
 * Transition-based, not state-based: it fires only when the status is actually
 * *changing into* a requiring stage without a project — editing an opportunity
 * already in a delivery stage, or reordering within its column, is never
 * blocked. A no-op (returns) whenever the target status doesn't require a
 * project or the row is already gone (the caller's write surfaces that).
 */
export async function assertOpportunityTransitionAllowed(
  opportunityId: string,
  nextStatus: OpportunityStatus,
): Promise<void> {
  if (!requiresProject(nextStatus)) return;

  const [current] = await db
    .select({ status: opportunities.status })
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId))
    .limit(1);

  if (
    current &&
    nextStatus !== current.status &&
    !(await opportunityHasProject(opportunityId))
  ) {
    throw new UserSafeActionError(
      "Create a project for this opportunity before moving it to Allocating or later.",
    );
  }
}
