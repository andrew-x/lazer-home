import { z } from "zod";
import { searchQuerySchema } from "@/lib/core/search";
import { id, idList } from "@/lib/schemas/id-schema";
import { SLACK_CHANNEL_KINDS } from "@/lib/slack/channel";

/**
 * Input schemas for the Slack channel actions.
 *
 * A pure, client-importable module (no `db`, no drizzle): the dialog and the
 * field components import these, so a Drizzle table here would drag the whole ORM
 * into the client bundle (ADR 0035).
 */

/**
 * Which channel slot an action is operating on. Parsed by the authorize hook off
 * the raw `clientInput` *before* the body runs, because it selects the capability
 * required — see `authorizeSlackChannel`.
 */
export const slackChannelKindSchema = z.enum(SLACK_CHANNEL_KINDS);

/**
 * The record whose channel slot we're touching. `recordId` is always the id of
 * the table that holds the column: an opportunity for `scoping`, a project for
 * `project`. One kind never reaches the other's table.
 */
export const slackChannelTargetSchema = z.object({
  kind: slackChannelKindSchema,
  recordId: id,
});

/**
 * Create a channel and link it. `staffIds` are the people to invite — ids, never
 * emails, so the server does the email lookup from `staff.email` and a caller
 * can't invite an arbitrary address. Capped well above any real invite list, as a
 * bound on the per-person Slack lookups a single call can trigger.
 */
export const createSlackChannelSchema = slackChannelTargetSchema.extend({
  staffIds: idList.pipe(z.array(id).max(50)),
});

/**
 * Link an existing channel. Takes the channel **id** only: the stored name is
 * resolved server-side, so a client can't write a name that doesn't match the
 * channel it points at. The max is generous next to Slack's 11-char ids.
 */
export const linkSlackChannelSchema = slackChannelTargetSchema.extend({
  channelId: z.string().min(1).max(32),
});

/** Clear a slot. App-side only — the Slack channel itself is left alone. */
export const unlinkSlackChannelSchema = slackChannelTargetSchema;

/**
 * Type-ahead over workspace channels.
 *
 * Takes `kind` but NOT `recordId`: the results are the same for every record of a
 * kind, because the only per-record exclusion — a channel already linked — is
 * global, and `channelIdsAlreadyLinked` covers it without knowing who's asking.
 *
 * `kind` is **nullish** so the action still satisfies the generic `SearchAction`
 * contract (an input reducible to `{ query }`), the same shape `searchProjects`
 * uses for its `companyId` scope. The picker always supplies it via `searchArgs`,
 * and a missing one returns nothing.
 *
 * Being optional here does NOT weaken the gate: `authorizeSlackChannel` parses
 * `kind` off the raw input and denies outright when it can't, so a kind-less
 * search never reaches the body.
 */
export const searchSlackChannelsSchema = searchQuerySchema.extend({
  kind: slackChannelKindSchema.nullish(),
});

/** Ask whether a similarly-named channel exists for an empty slot. */
export const suggestSlackChannelSchema = slackChannelTargetSchema;

export type SlackChannelTargetInput = z.infer<typeof slackChannelTargetSchema>;
export type CreateSlackChannelInput = z.infer<typeof createSlackChannelSchema>;
export type LinkSlackChannelInput = z.infer<typeof linkSlackChannelSchema>;
export type UnlinkSlackChannelInput = z.infer<typeof unlinkSlackChannelSchema>;
export type SearchSlackChannelsInput = z.infer<
  typeof searchSlackChannelsSchema
>;
export type SuggestSlackChannelInput = z.infer<
  typeof suggestSlackChannelSchema
>;
