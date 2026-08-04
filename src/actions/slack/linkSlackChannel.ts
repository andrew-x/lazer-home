"use server";

import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { isUniqueViolation } from "@/lib/db/unique-violation";
import { authorizeSlackChannel } from "./authorizeSlackChannel";
import { getSlackChannels } from "./getSlackChannels";
import { linkSlackChannelSchema } from "./slackChannel.schema";
import {
  channelIdsAlreadyLinked,
  SLACK_CHANNEL_TARGETS,
} from "./slackChannelLink";

/**
 * Point a record at a Slack channel that already exists.
 *
 * Two deliberate non-behaviours:
 *
 * - **It never invites anyone and never joins the channel.** `conversations.invite`
 *   requires the caller to be a member, and quietly inserting our bot into
 *   somebody's existing private channel isn't ours to do. Linking is a statement
 *   about our records, not an action inside Slack.
 * - **It never takes a channel name from the client.** Only the id crosses the
 *   wire; the stored name is resolved here from the workspace listing, so the
 *   displayed name can't be made to disagree with the channel it links to.
 * - **It never requires the naming convention.** Any channel the bot can see is
 *   linkable — the whole point of linking is to adopt channels that predate the
 *   convention. Creating is what enforces the naming.
 *
 * The channel must still appear in the workspace listing, so an id for something the
 * bot can't see is rejected rather than stored blind.
 */
export const linkSlackChannel = secureActionClient
  .metadata({
    action: "link-slack-channel",
    authorize: authorizeSlackChannel,
  })
  .inputSchema(linkSlackChannelSchema)
  .action(async ({ parsedInput: { kind, recordId, channelId } }) => {
    const target = SLACK_CHANNEL_TARGETS[kind];

    const record = await target.read(recordId);
    if (!record) throw new UserSafeActionError("That record no longer exists.");
    if (record.channelId) {
      throw new UserSafeActionError(
        `This ${target.label.toLowerCase()} is already linked.`,
      );
    }

    const { configured, channels } = await getSlackChannels();
    if (!configured) {
      throw new UserSafeActionError("Slack isn't connected.");
    }

    const channel = channels.find((candidate) => candidate.id === channelId);
    if (!channel) {
      throw new UserSafeActionError(
        "We can't find that channel in Slack any more.",
      );
    }

    const taken = await channelIdsAlreadyLinked([channel.id]);
    if (taken.has(channel.id)) {
      throw new UserSafeActionError(
        "That Slack channel is already linked to another record.",
      );
    }

    try {
      const linked = await target.link(recordId, {
        id: channel.id,
        name: channel.name,
      });
      if (!linked) {
        // The `isNull` guard lost a race, or the record went away.
        throw new UserSafeActionError(
          "That slot was just filled — reload and try again.",
        );
      }
    } catch (error) {
      // Third layer of the double-click defence, after the pre-read and the
      // `isNull` guard: two records claiming the same channel at once.
      if (isUniqueViolation(error, target.uniqueConstraint)) {
        throw new UserSafeActionError(
          "That Slack channel is already linked to another record.",
        );
      }
      throw error;
    }

    // Nothing changed in Slack, so the cached channel list is still accurate —
    // no `updateTag` here, unlike the create path.
    target.revalidate(recordId);

    return { channelId: channel.id, channelName: channel.name };
  });
