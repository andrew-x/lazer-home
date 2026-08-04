"use server";

import { secureActionClient } from "@/lib/core/action";
import {
  buildSlackChannelName,
  formatSlackChannel,
  SLACK_CHANNEL_MATCH_THRESHOLD,
  scoreSlackChannelMatch,
} from "@/lib/slack/channel";
import { authorizeSlackChannel } from "./authorizeSlackChannel";
import { getSlackChannels } from "./getSlackChannels";
import { suggestSlackChannelSchema } from "./slackChannel.schema";
import {
  channelIdsAlreadyLinked,
  SLACK_CHANNEL_TARGETS,
} from "./slackChannelLink";

/**
 * "We found #l-project-acme — is this it?" for a record with an empty slot.
 *
 * A client-triggered read (the `loadOpportunityPlan` idiom) rather than a field on
 * the detail payload, deliberately: a cold channel-list cache costs several
 * sequential Slack round-trips, and neither the opportunity drawer nor the project
 * page should wait on Slack to render. The stored link is already on the detail
 * payload for free; only this needs the network.
 *
 * Strictly one record per call. It must never be wired into a list or the kanban,
 * where it would fan out into a Slack round-trip per card.
 */
export const suggestSlackChannel = secureActionClient
  .metadata({
    action: "suggest-slack-channel",
    authorize: authorizeSlackChannel,
  })
  .inputSchema(suggestSlackChannelSchema)
  .action(async ({ parsedInput: { kind, recordId } }) => {
    const target = SLACK_CHANNEL_TARGETS[kind];

    const record = await target.read(recordId);
    // Nothing to suggest for a record that's gone, or a slot already filled.
    if (!record || record.channelId) return { suggestion: null };

    const { configured, channels } = await getSlackChannels();
    if (!configured) return { suggestion: null };

    const expected = buildSlackChannelName(kind, record.sourceName, recordId);

    const ranked = channels
      .map((channel) => ({
        ...channel,
        score: scoreSlackChannelMatch(channel.name, expected),
      }))
      .filter((channel) => channel.score >= SLACK_CHANNEL_MATCH_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      // Only the shortlist needs the already-linked check — this is what keeps it
      // to one indexed lookup instead of a scan of every link in the system.
      .slice(0, SUGGESTION_SHORTLIST);

    if (ranked.length === 0) return { suggestion: null };

    const taken = await channelIdsAlreadyLinked(
      ranked.map((channel) => channel.id),
    );
    const best = ranked.find((channel) => !taken.has(channel.id));
    if (!best) return { suggestion: null };

    return {
      suggestion: {
        channelId: best.id,
        // Display-shaped, since the only consumer renders it directly.
        channelName: formatSlackChannel(best.name),
      },
    };
  });

/**
 * How many top candidates to check for an existing link before giving up. Only
 * one is ever shown; the extras cover the case where the closest names are
 * already taken.
 */
const SUGGESTION_SHORTLIST = 5;
