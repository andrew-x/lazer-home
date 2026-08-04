"use server";

import { inArray } from "drizzle-orm";
import { updateTag } from "next/cache";
import { z } from "zod";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { db } from "@/lib/db/db";
import { staff } from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/db/unique-violation";
import {
  buildSlackChannelCreateName,
  formatSlackChannel,
  SLACK_CHANNEL_IS_PRIVATE,
} from "@/lib/slack/channel";
import { authorizeSlackChannel } from "./authorizeSlackChannel";
import { getSlackChannels, SLACK_CHANNELS_TAG } from "./getSlackChannels";
import { SLACK_NOT_CONFIGURED, SlackApiError, slackPost } from "./slackApi";
import { createSlackChannelSchema } from "./slackChannel.schema";
import { SLACK_CHANNEL_TARGETS } from "./slackChannelLink";
import { resolveSlackUserIds } from "./slackUsers";

/**
 * Create a Slack channel for a record and link it.
 *
 * The step order here is the design, not incidental, because **creating a Slack
 * channel is not transactional with our DB write and Slack has no
 * `conversations.delete`.** So:
 *
 * 1. everything that can cheaply fail runs *before* the irreversible call —
 *    including resolving invitees, which is the flakiest part (one Slack lookup
 *    per person) and would otherwise strand a channel on a total failure;
 * 2. the link is persisted immediately after the channel exists, so the window
 *    where a channel exists un-recorded is as small as possible;
 * 3. if that persist still fails, we archive the just-created channel (the
 *    closest thing to a delete) — safe precisely because nobody has been invited
 *    yet, which is why invites come last;
 * 4. invites are best-effort. A person Slack can't find is reported as a warning,
 *    not a failure — the channel is made and linked, and one missing invitee
 *    shouldn't undo that.
 */
export const createSlackChannel = secureActionClient
  .metadata({
    action: "create-slack-channel",
    authorize: authorizeSlackChannel,
  })
  .inputSchema(createSlackChannelSchema)
  .action(async ({ parsedInput: { kind, recordId, staffIds } }) => {
    const target = SLACK_CHANNEL_TARGETS[kind];

    // --- Everything reversible, first ------------------------------------
    const record = await target.read(recordId);
    if (!record) throw new UserSafeActionError("That record no longer exists.");
    if (record.channelId) {
      throw new UserSafeActionError(
        `This ${target.label.toLowerCase()} is already linked.`,
      );
    }

    // The *create* name, so a non-production environment gets the `test-` marker
    // and can't quietly litter the real workspace. Same call the dialog's preview
    // makes, so the two can't disagree.
    const name = buildSlackChannelCreateName(kind, record.sourceName, recordId);
    const isPrivate = SLACK_CHANNEL_IS_PRIVATE[kind];

    // Catch the collision before spending a create on it, so the common case
    // gets the actionable message rather than Slack's `name_taken`. Not
    // authoritative — the list is cached and may be degraded — so the
    // `name_taken` branch below is still the real guard.
    const { channels } = await getSlackChannels();
    if (channels.some((channel) => channel.name === name)) {
      throw new UserSafeActionError(
        `${formatSlackChannel(name)} already exists in Slack — link it instead.`,
      );
    }

    // Emails are read here rather than accepted from the client, so a caller
    // can't invite an arbitrary address by passing one in.
    const emails =
      staffIds.length === 0
        ? []
        : await db
            .select({ email: staff.email })
            .from(staff)
            .where(inArray(staff.id, staffIds))
            .then((rows) => rows.map((row) => row.email));

    const { userIds, missingEmails } = await resolveSlackUserIds(emails);

    // --- The irreversible call -------------------------------------------
    let channelId: string;
    let channelName: string;
    try {
      const created = await slackPost(
        "conversations.create",
        { name, is_private: isPrivate },
        createResponseSchema,
      );
      channelId = created.channel.id;
      // Slack normalises names on create, so the name we store is the one it
      // gave back — never the one we asked for.
      channelName = created.channel.name;
    } catch (error) {
      throw createFailureError(error, name);
    }

    // --- Record it, or undo it -------------------------------------------
    try {
      const linked = await target.link(recordId, {
        id: channelId,
        name: channelName,
      });
      if (!linked) {
        throw new Error("link guard rejected the write");
      }
    } catch (error) {
      if (isUniqueViolation(error, target.uniqueConstraint)) {
        // Vanishingly unlikely (we just created this channel), but a fresh id
        // colliding with an existing link must not be reported as success.
        await archiveQuietly(channelId, channelName);
        throw new UserSafeActionError(
          "That Slack channel is already linked to another record.",
        );
      }
      // We own a channel we failed to record. Archive it so we don't leave
      // clutter behind, and say which one in case the archive also failed.
      await archiveQuietly(channelId, channelName);
      logger.error("slack_channel_orphaned", {
        kind,
        recordId,
        channelId,
        channelName,
        message: error instanceof Error ? error.message : String(error),
      });
      throw new UserSafeActionError(
        `Slack created ${formatSlackChannel(channelName)} but we couldn't save the link. It has been archived — try again.`,
      );
    }

    // --- Best-effort invites ---------------------------------------------
    const warnings: string[] = [];
    if (missingEmails.length > 0) {
      warnings.push(
        `${missingEmails.length} ${missingEmails.length === 1 ? "person" : "people"} couldn't be found on Slack.`,
      );
    }
    if (userIds.length > 0) {
      const failed = await inviteUsers(channelId, userIds);
      if (failed > 0) {
        warnings.push(
          `${failed} ${failed === 1 ? "person" : "people"} couldn't be added — invite them in Slack.`,
        );
      }
    }

    // The new channel must be searchable straight away, so this is `updateTag`
    // (immediate expiry, read-your-own-writes) and not `revalidateTag`, whose
    // single-argument form is deprecated and whose stale-while-revalidate form
    // would keep serving a list without this channel in it.
    updateTag(SLACK_CHANNELS_TAG);
    target.revalidate(recordId);

    return { channelId, channelName, warnings };
  });

const createResponseSchema = z.object({
  channel: z.object({ id: z.string(), name: z.string() }),
});

/**
 * With `force: true` Slack answers `ok: true` and reports the users it *couldn't*
 * add in an `errors` array. Capturing it is what makes the "N couldn't be added"
 * warning honest — dropping the field would report a partial invite as a clean one.
 */
const inviteResponseSchema = z.object({
  errors: z
    .array(z.object({ error: z.string(), user: z.string().optional() }))
    .optional(),
});

/** Slack caps a single invite call; chunk to stay under it. */
const INVITE_CHUNK = 100;

/**
 * Invite users in chunks, returning how many we failed to add.
 *
 * `force: true` matters: without it one bad user id aborts the entire call, so a
 * single ex-employee's stale id would silently cost everyone else their invite.
 * `already_in_channel` is not a failure — the creator is a member by definition.
 */
async function inviteUsers(
  channelId: string,
  userIds: string[],
): Promise<number> {
  let failed = 0;

  for (let i = 0; i < userIds.length; i += INVITE_CHUNK) {
    const chunk = userIds.slice(i, i + INVITE_CHUNK);
    try {
      const result = await slackPost(
        "conversations.invite",
        { channel: channelId, users: chunk.join(","), force: true },
        inviteResponseSchema,
      );
      // Per-user failures inside a successful call. Someone already in the
      // channel isn't one — the creator is a member by definition.
      const rejected = (result.errors ?? []).filter(
        (entry) => entry.error !== "already_in_channel",
      );
      if (rejected.length > 0) {
        failed += rejected.length;
        logger.warn("slack_invite_partial", {
          channelId,
          count: rejected.length,
          codes: [...new Set(rejected.map((entry) => entry.error))],
        });
      }
    } catch (error) {
      if (
        error instanceof SlackApiError &&
        error.code === "already_in_channel"
      ) {
        continue;
      }
      failed += chunk.length;
      logger.warn("slack_invite_failed", {
        channelId,
        count: chunk.length,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return failed;
}

/**
 * Archive a channel we created but couldn't record — the compensating action for
 * a failed link, since Slack offers no delete. Never throws: it runs on an error
 * path, and its own failure must not replace the error we're already reporting.
 */
async function archiveQuietly(
  channelId: string,
  channelName: string,
): Promise<void> {
  try {
    await slackPost(
      "conversations.archive",
      { channel: channelId },
      z.object({}),
    );
  } catch (error) {
    logger.error("slack_channel_archive_failed", {
      channelId,
      channelName,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Map Slack's create errors onto copy that tells the user what to do next. */
function createFailureError(error: unknown, name: string): UserSafeActionError {
  const code = error instanceof SlackApiError ? error.code : null;
  const channel = formatSlackChannel(name);

  switch (code) {
    case SLACK_NOT_CONFIGURED:
      // Reachable on purpose: the setup button is offered even with no token, so
      // this is the message that explains the dead end when someone clicks through.
      return new UserSafeActionError(
        "Slack isn't connected — an admin needs to set SLACK_BOT_TOKEN.",
      );
    case "name_taken":
      return new UserSafeActionError(
        `${channel} already exists in Slack — link it instead.`,
      );
    case "invalid_name":
    case "invalid_name_specials":
    case "invalid_name_maxlength":
    case "invalid_name_punctuation":
    case "invalid_name_required":
      // Unreachable if `buildSlackChannelName` is right, so this is a bug
      // signal, not a user mistake — log it as one.
      logger.error("slack_channel_name_rejected", { name, code });
      return new UserSafeActionError(
        `Slack rejected the name ${channel}. Rename the record and try again.`,
      );
    case "restricted_action":
      return new UserSafeActionError(
        "Your Slack workspace doesn't allow this app to create channels.",
      );
    case "missing_scope":
      return new UserSafeActionError(
        "The Slack app is missing a permission — it needs reinstalling.",
      );
    case "invalid_auth":
    case "account_inactive":
    case "token_revoked":
      return new UserSafeActionError(
        "The Slack connection needs reconnecting.",
      );
    case "ratelimited":
      return new UserSafeActionError(
        "Slack is rate limiting us — try again in a minute.",
      );
    default:
      return new UserSafeActionError("Couldn't create the Slack channel.");
  }
}
