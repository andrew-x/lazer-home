"use server";

import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { authorizeSlackChannel } from "./authorizeSlackChannel";
import { unlinkSlackChannelSchema } from "./slackChannel.schema";
import { SLACK_CHANNEL_TARGETS } from "./slackChannelLink";

/**
 * Detach a record from its Slack channel. **Clears our columns and nothing else** —
 * the channel, its history and its members are untouched, which is what the
 * confirmation copy promises.
 *
 * In scope from day one rather than deferred, because it's the only escape hatch
 * for the three ways a link goes bad: the wrong channel was linked, the channel
 * was archived in Slack, or our bot was removed from it and can no longer see it.
 * Without this, any of those is permanent.
 */
export const unlinkSlackChannel = secureActionClient
  .metadata({
    action: "unlink-slack-channel",
    authorize: authorizeSlackChannel,
  })
  .inputSchema(unlinkSlackChannelSchema)
  .action(async ({ parsedInput: { kind, recordId } }) => {
    const target = SLACK_CHANNEL_TARGETS[kind];

    const cleared = await target.unlink(recordId);
    if (!cleared) {
      throw new UserSafeActionError("That record no longer exists.");
    }

    target.revalidate(recordId);

    return { recordId };
  });
