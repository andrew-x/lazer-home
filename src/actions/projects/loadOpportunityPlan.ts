"use server";

import { z } from "zod";
import { secureActionClient } from "@/lib/action";
import { id } from "@/lib/id-schema";
import { getOpportunityPlan } from "./getOpportunityPlan";

/**
 * Client-triggered planner load for the opportunity drawer's Project plan tab
 * (the interactive-read exception, same shape as `loadOpportunityDetail`). Gated
 * on `crm.edit`: the planner lives in the edit-only drawer. The read is open in
 * spirit (any planner viewer sees it); write controls are separately gated on
 * `projects.edit` at each mutating action. Delegates to the server-only
 * `getOpportunityPlan`.
 */
export const loadOpportunityPlan = secureActionClient
  .metadata({
    action: "load-opportunity-plan",
    permission: { crm: ["edit"] },
  })
  .inputSchema(z.object({ opportunityId: id }))
  .action(({ parsedInput }) => getOpportunityPlan(parsedInput.opportunityId));
