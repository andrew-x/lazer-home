"use server";

import { secureActionClient } from "@/lib/core/action";
import { SEARCH_LIMIT } from "@/lib/core/search";
import { formatSlackChannel } from "@/lib/slack/channel";
import { authorizeSlackChannel } from "./authorizeSlackChannel";
import { getSlackChannels } from "./getSlackChannels";
import { searchSlackChannelsSchema } from "./slackChannel.schema";
import { channelIdsAlreadyLinked } from "./slackChannelLink";

/**
 * Type-ahead over workspace channels, backing the "link an existing channel"
 * picker. `SearchAction`-shaped (`{ query }` in, `{ id, name }` out) so it drops
 * straight into `EntityCombobox`.
 *
 * Filtering happens in memory over the cached channel listing rather than as a
 * Slack search call — Slack has no channel-search endpoint we can use with a bot
 * token, and the listing is already fetched and cached for the suggestions.
 *
 * A blank query returns nothing, matching every other picker in the app and also
 * meaning the control can't be used to page through the whole workspace.
 *
 * `name` comes back with its `#` because `EntityCombobox` renders the label
 * verbatim; the alternative was teaching that shared primitive about Slack.
 *
 * Channels already linked elsewhere are dropped — offering one would only produce
 * a rejection from `linkSlackChannel`.
 *
 * **No naming-convention filter, by design.** Search spans every channel the bot
 * can see, private ones included, because scoping channels that predate the
 * `l-scoping-` convention are exactly the ones people most need to link — and
 * requiring a rename first would make the feature useless on existing deals.
 *
 * The consequence to know: for anyone holding `crm.edit`/`projects.edit`, this
 * discloses the *name* of every private channel our bot has been invited to, which
 * in Slack a non-member cannot see. That is bounded — a channel is invisible to the
 * bot until someone deliberately invites it — but it makes "don't invite this app
 * to sensitive private channels" a real operational rule. Requiring a non-blank
 * query is what stops the picker being used to enumerate a list wholesale.
 *
 * Nor are results filtered to the kind's own visibility: if a scoping channel was
 * made public by mistake you can still link it. Public/private only governs what we
 * *create*.
 */
export const searchSlackChannels = secureActionClient
  .metadata({
    action: "search-slack-channels",
    authorize: authorizeSlackChannel,
  })
  .inputSchema(searchSlackChannelsSchema)
  .action(async ({ parsedInput: { query, kind } }) => {
    // `kind` is nullish only to satisfy the generic `SearchAction` contract; the
    // authorize hook has already refused anything without a valid one.
    if (query === "" || !kind) return [];

    const { channels } = await getSlackChannels();
    const needle = query.toLowerCase().replace(/^#/, "");

    const matches = channels
      .filter((channel) => channel.name.includes(needle))
      // Shortest name first: with a substring match, the shortest is the closest
      // to what was typed.
      .sort(
        (a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name),
      )
      // Over-fetch a little so dropping already-linked channels below doesn't
      // leave a short list.
      .slice(0, SEARCH_LIMIT * 2);

    if (matches.length === 0) return [];

    const taken = await channelIdsAlreadyLinked(
      matches.map((channel) => channel.id),
    );

    return matches
      .filter((channel) => !taken.has(channel.id))
      .slice(0, SEARCH_LIMIT)
      .map((channel) => ({
        id: channel.id,
        name: formatSlackChannel(channel.name),
      }));
  });
