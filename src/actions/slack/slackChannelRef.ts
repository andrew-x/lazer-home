import "server-only";

import { env } from "@/env";
import { type SlackChannelRef, slackChannelUrl } from "@/lib/slack/channel";

/**
 * Build the shape the UI renders from a stored link. The single place reads turn
 * the two columns into a channel reference, so the deep-link format and the
 * "both null or neither" rule are stated once.
 *
 * The URL is assembled here, server-side, because it needs `SLACK_TEAM_ID` — that
 * keeps the env var off the client entirely instead of shipping it down just so a
 * component can concatenate a string.
 */
export function toSlackChannelRef(
  channelId: string | null,
  channelName: string | null,
): SlackChannelRef | null {
  // The DB check constraints make a half-written link unrepresentable; this
  // mirrors the same rule for the type system's benefit.
  if (!channelId || !channelName) return null;
  return {
    id: channelId,
    name: channelName,
    url: slackChannelUrl(channelId, env.SLACK_TEAM_ID),
  };
}
