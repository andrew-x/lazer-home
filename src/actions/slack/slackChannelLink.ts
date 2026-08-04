import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { revalidateProject } from "@/actions/projects/revalidate";
import type { PermissionCheck } from "@/lib/auth/permissions";
import { db } from "@/lib/db/db";
import { opportunities, projects } from "@/lib/db/schema";
import type { SlackChannelKind } from "@/lib/slack/channel";

/**
 * Where each channel kind lives, as one table — the only place in the feature
 * that knows a `kind` maps to a table, a column pair and a capability.
 *
 * This exists to close a specific hole. The two kinds are gated by *different*
 * capabilities (`crm.edit` vs `projects.edit`), so if the authorize hook decided
 * which capability to require from one source and an action body decided which
 * table to write from another, the two could disagree — and someone with only
 * `crm.edit` could write a `projects` column. Both the hook and every body read
 * the same entry here, so that divergence isn't expressible.
 *
 * The entries hold closures rather than raw Drizzle column handles: it keeps each
 * query concretely typed against its own table, and keeps the `isNull` link guard
 * next to the column it guards.
 */

type SlackChannelLinkRow = {
  channelId: string | null;
  channelName: string | null;
  /** The record's own name — what the channel name is derived from. */
  sourceName: string;
};

type SlackChannelTarget = {
  /** Human label for this slot, used in action error copy. */
  label: string;
  /** The capability required to create, link or unlink this kind. */
  permission: PermissionCheck;
  /**
   * The unique index a concurrent link violates, for `isUniqueViolation`. Named
   * here so the constraint name lives beside the write that can trip it.
   */
  uniqueConstraint: string;
  /** Current link + the source name, or null when the record doesn't exist. */
  read(recordId: string): Promise<SlackChannelLinkRow | null>;
  /**
   * Attach a channel, but only if the slot is still empty. The `isNull` guard
   * makes this the atomic half of the double-click defence (the
   * `associateOpportunityProject` idiom) — false means someone else won the race
   * or the record is gone.
   */
  link(
    recordId: string,
    channel: { id: string; name: string },
  ): Promise<boolean>;
  /** Clear the slot. Never touches Slack. */
  unlink(recordId: string): Promise<boolean>;
  /** Refresh every route that renders this record's channel. */
  revalidate(recordId: string): void;
};

export const SLACK_CHANNEL_TARGETS: Record<
  SlackChannelKind,
  SlackChannelTarget
> = {
  scoping: {
    label: "Scoping channel",
    permission: { crm: ["edit"] },
    uniqueConstraint: "opportunities_scoping_slack_channel_idx",
    async read(recordId) {
      const rows = await db
        .select({
          channelId: opportunities.scopingSlackChannelId,
          channelName: opportunities.scopingSlackChannelName,
          sourceName: opportunities.name,
        })
        .from(opportunities)
        .where(eq(opportunities.id, recordId))
        .limit(1);
      return rows.at(0) ?? null;
    },
    async link(recordId, channel) {
      const rows = await db
        .update(opportunities)
        .set({
          scopingSlackChannelId: channel.id,
          scopingSlackChannelName: channel.name,
        })
        .where(
          and(
            eq(opportunities.id, recordId),
            isNull(opportunities.scopingSlackChannelId),
          ),
        )
        .returning({ id: opportunities.id });
      return rows.length > 0;
    },
    async unlink(recordId) {
      const rows = await db
        .update(opportunities)
        .set({ scopingSlackChannelId: null, scopingSlackChannelName: null })
        .where(eq(opportunities.id, recordId))
        .returning({ id: opportunities.id });
      return rows.length > 0;
    },
    revalidate() {
      // An opportunity has no page of its own — its detail is a drawer over the
      // board, so this is the only route that renders the scoping channel.
      revalidatePath("/opportunities");
    },
  },

  project: {
    label: "Slack channel",
    permission: { projects: ["edit"] },
    uniqueConstraint: "projects_slack_channel_idx",
    async read(recordId) {
      const rows = await db
        .select({
          channelId: projects.slackChannelId,
          channelName: projects.slackChannelName,
          sourceName: projects.name,
        })
        .from(projects)
        .where(eq(projects.id, recordId))
        .limit(1);
      return rows.at(0) ?? null;
    },
    async link(recordId, channel) {
      const rows = await db
        .update(projects)
        .set({ slackChannelId: channel.id, slackChannelName: channel.name })
        .where(and(eq(projects.id, recordId), isNull(projects.slackChannelId)))
        .returning({ id: projects.id });
      return rows.length > 0;
    },
    async unlink(recordId) {
      const rows = await db
        .update(projects)
        .set({ slackChannelId: null, slackChannelName: null })
        .where(eq(projects.id, recordId))
        .returning({ id: projects.id });
      return rows.length > 0;
    },
    revalidate(recordId) {
      revalidateProject(recordId);
    },
  },
};

/**
 * Which of these Slack channel ids are already linked to some record?
 *
 * Used to keep a channel from being linked twice, and to keep an already-taken
 * channel out of search results and suggestions. Deliberately takes the specific
 * ids in question — a candidate shortlist — rather than reading every linked id,
 * so this stays two indexed lookups regardless of how many records exist.
 *
 * Note this spans BOTH kinds: the per-table unique indexes stop a channel being
 * linked to two opportunities, but nothing at the DB level stops the same channel
 * being both an opportunity's scoping channel and a project's delivery channel.
 * That's a mistake to prevent in the UI rather than a data-integrity invariant,
 * which is why it's enforced here instead of with a constraint.
 */
export async function channelIdsAlreadyLinked(
  channelIds: string[],
): Promise<Set<string>> {
  if (channelIds.length === 0) return new Set();

  const [scopingRows, projectRows] = await Promise.all([
    db
      .select({ channelId: opportunities.scopingSlackChannelId })
      .from(opportunities)
      .where(inArray(opportunities.scopingSlackChannelId, channelIds)),
    db
      .select({ channelId: projects.slackChannelId })
      .from(projects)
      .where(inArray(projects.slackChannelId, channelIds)),
  ]);

  const taken = new Set<string>();
  for (const row of [...scopingRows, ...projectRows]) {
    if (row.channelId) taken.add(row.channelId);
  }
  return taken;
}
