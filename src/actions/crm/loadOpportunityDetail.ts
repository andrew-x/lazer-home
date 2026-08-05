"use server";

import { z } from "zod";
import { isDriveConfigured } from "@/actions/drive/driveApi";
import { isSlackConfigured } from "@/actions/slack/slackApi";
import { getCurrentStaffIdentity } from "@/actions/staff/getCurrentStaffIdentity";
import { secureActionClient } from "@/lib/core/action";
import { id } from "@/lib/schemas/id-schema";
import { getOpportunity, type OpportunityDetail } from "./getOpportunity";

/** What the drawer needs on open: the opportunity, plus the viewer's own staff
 * identity to default the task composer's owner to the current user. */
export type OpportunityDrawerData = {
  detail: OpportunityDetail | null;
  currentStaff: { id: string; name: string } | null;
  /**
   * Whether the Slack integration is configured at all. On the envelope rather
   * than on `OpportunityDetail`, because it describes the *environment*, not this
   * opportunity — the same reason `currentStaff` sits here.
   */
  slackEnabled: boolean;
  /**
   * Whether the Google Drive integration is configured at all. On the envelope
   * for the same reason as `slackEnabled` — it describes the environment.
   */
  driveEnabled: boolean;
};

/**
 * Client-triggered detail load for the opportunity drawer (the interactive-read
 * exception to the server-only read rule — same shape as `searchStaff`). Gated on
 * `crm.edit`: the drawer is edit-only, so this can't leak detail past the write
 * gate. Delegates to the server-only `getOpportunity` read, and bundles the
 * viewer's staff identity so the drawer's task composer can default its owner —
 * fetched in the same round-trip rather than threaded as a prop through the board.
 */
export const loadOpportunityDetail = secureActionClient
  .metadata({
    action: "load-opportunity-detail",
    permission: { crm: ["edit"] },
  })
  .inputSchema(z.object({ id }))
  .action(async ({ parsedInput }): Promise<OpportunityDrawerData> => {
    const [detail, currentStaff] = await Promise.all([
      getOpportunity(parsedInput.id),
      getCurrentStaffIdentity(),
    ]);
    // Both read env vars only — deliberately NOT round-trips to Slack or Drive,
    // so opening the drawer never waits on either. The parts that do need the
    // network (the channel suggestion, the folder listing) are separate actions
    // fired after render.
    return {
      detail,
      currentStaff,
      slackEnabled: isSlackConfigured(),
      driveEnabled: isDriveConfigured(),
    };
  });
