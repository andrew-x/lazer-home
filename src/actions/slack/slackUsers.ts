import "server-only";

import { z } from "zod";
import { logger } from "@/lib/core/logger";
import { SlackApiError, slackGet } from "./slackApi";

/**
 * Email → Slack user id, the join that lets the create dialog invite people.
 *
 * We can use email as the key because the two systems share it: `staff.email`
 * comes from the Rippling import and is the same address people sign into Slack
 * with. That is also why the client only ever sends staff **ids** — the emails
 * are looked up server-side, so a caller can't invite an arbitrary address.
 *
 * A person who can't be resolved is reported back rather than failing the whole
 * operation: someone genuinely not in the workspace shouldn't block creating the
 * channel for everyone else.
 */

/** Cache tag for the email→id lookups. */
export const SLACK_USERS_TAG = "slack-users";

/** Slack accounts change rarely; six hours is plenty. */
const REVALIDATE_SECONDS = 60 * 60 * 6;

const lookupByEmailSchema = z.object({
  user: z.object({ id: z.string() }),
});

export type ResolvedSlackUsers = {
  userIds: string[];
  /** Emails Slack had no account for, for a "couldn't add N people" warning. */
  missingEmails: string[];
};

/**
 * Resolve each email to a Slack user id, tolerating individual misses.
 *
 * Called *before* `conversations.create` on purpose: this is the flakiest and
 * highest-fan-out step (one Tier 3 call per person), and doing it first means a
 * total failure costs nothing, instead of leaving an orphaned channel behind.
 */
export async function resolveSlackUserIds(
  emails: string[],
): Promise<ResolvedSlackUsers> {
  const unique = [...new Set(emails.map((email) => email.toLowerCase()))];

  const results = await Promise.all(
    unique.map(async (email) => {
      try {
        const data = await slackGet(
          "users.lookupByEmail",
          { email },
          lookupByEmailSchema,
          { revalidate: REVALIDATE_SECONDS, tags: [SLACK_USERS_TAG] },
        );
        return { email, userId: data.user.id };
      } catch (error) {
        // `users_not_found` is an ordinary outcome (a contractor with no Slack
        // account); anything else is worth a line in the log, but neither is
        // worth failing the create for.
        if (
          !(error instanceof SlackApiError) ||
          error.code !== "users_not_found"
        ) {
          logger.warn("slack_user_lookup_failed", {
            message: error instanceof Error ? error.message : String(error),
          });
        }
        return { email, userId: null };
      }
    }),
  );

  return {
    userIds: results
      .map((result) => result.userId)
      .filter((id): id is string => id !== null),
    missingEmails: results
      .filter((result) => result.userId === null)
      .map((result) => result.email),
  };
}
