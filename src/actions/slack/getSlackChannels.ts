import "server-only";

import { z } from "zod";
import { logger } from "@/lib/core/logger";
import { isSlackConfigured, slackGet } from "./slackApi";

/**
 * The workspace's channel list, cached — the single source both channel search
 * and the "is this it?" suggestion read from.
 *
 * Shaped like `getExchangeRates` (ADR 0029) and for the same reason: this sits on
 * the render path of a detail surface, so it **never throws**. A Slack outage
 * degrades the feature to "you can't find a channel right now", it does not break
 * an opportunity drawer.
 *
 * The one disclosure fact worth holding onto while reading this: `groups:read`
 * only returns PRIVATE channels our bot has been added to. So `channels` is
 * complete for public channels and deliberately partial for private ones — the
 * limit the UI explains with its `/invite` guidance rather than working around.
 */

/** Cache tag for the channel list, so a create can immediately show its channel. */
export const SLACK_CHANNELS_TAG = "slack-channels";

/** Channels change rarely; an hour keeps us far inside Slack's Tier 2 limits. */
const REVALIDATE_SECONDS = 60 * 60;

/**
 * Pages of 200 to fetch at most (~1000 channels). A bound rather than an
 * unlimited loop so one huge workspace can't turn a drawer open into dozens of
 * sequential Slack round-trips. Hitting it is logged, never silent.
 */
const PAGE_MAX = 5;

const PAGE_SIZE = 200;

const conversationsListSchema = z.object({
  channels: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      is_private: z.boolean().optional(),
    }),
  ),
  response_metadata: z
    .object({ next_cursor: z.string().optional() })
    .optional(),
});

export type SlackChannelSummary = {
  id: string;
  name: string;
  isPrivate: boolean;
};

export type SlackChannelList = {
  /** False when no bot token is set — the feature is off, not broken. */
  configured: boolean;
  /**
   * True when the list is known-incomplete: a page failed, or the page cap was
   * hit. Callers must not treat "not in this list" as "does not exist" when set —
   * it can only cost a missed suggestion, and `name_taken` catches the rest.
   */
  degraded: boolean;
  channels: SlackChannelSummary[];
};

export async function getSlackChannels(): Promise<SlackChannelList> {
  if (!isSlackConfigured()) {
    return { configured: false, degraded: false, channels: [] };
  }

  const channels: SlackChannelSummary[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < PAGE_MAX; page += 1) {
    try {
      const data = await slackGet(
        "conversations.list",
        {
          limit: String(PAGE_SIZE),
          exclude_archived: "true",
          types: "public_channel,private_channel",
          ...(cursor ? { cursor } : {}),
        },
        conversationsListSchema,
        { revalidate: REVALIDATE_SECONDS, tags: [SLACK_CHANNELS_TAG] },
      );

      for (const channel of data.channels) {
        channels.push({
          id: channel.id,
          name: channel.name,
          isPrivate: channel.is_private ?? false,
        });
      }

      cursor = data.response_metadata?.next_cursor || undefined;
      if (!cursor) return { configured: true, degraded: false, channels };
    } catch (error) {
      // Return what we gathered rather than nothing: a partial list still serves
      // search and suggestions, where the worst case is a missed match. Note a
      // cached first page can outlive its cursor, which surfaces here as a
      // mid-pagination failure — the same degraded path covers it.
      logger.warn("slack_channels_partial", {
        page,
        collected: channels.length,
        message: error instanceof Error ? error.message : String(error),
      });
      return { configured: true, degraded: true, channels };
    }
  }

  // Ran out of pages with a cursor still outstanding.
  logger.warn("slack_channels_page_cap", {
    pageMax: PAGE_MAX,
    collected: channels.length,
  });
  return { configured: true, degraded: true, channels };
}
