/**
 * Slack channel naming and matching.
 *
 * A pure, client-importable module (no `db`, no drizzle, no `env`) — the same
 * role `format/fx.ts` plays for the exchange-rate call. It lives in its own
 * folder rather than under `crm/` or `projects/` because both domains own one of
 * the two channel kinds, so neither is its home (ADR 0036).
 *
 * The reason the *name builder* is here rather than server-side: the create
 * dialog shows the exact channel name it is about to make, and the action passes
 * that same name to `conversations.create`. Both call this function, so the
 * preview and the reality cannot drift.
 *
 * See docs/domains/slack.md and docs/decisions/0066.
 */

/** The two kinds of channel we link. Each lives on exactly one table. */
export const SLACK_CHANNEL_KINDS = ["scoping", "project"] as const;
export type SlackChannelKind = (typeof SLACK_CHANNEL_KINDS)[number];

/**
 * The naming convention, as agreed with the team: `l-scoping-<slug>` for a
 * deal's pursuit channel, `l-project-<slug>` for a delivery channel.
 */
export const SLACK_CHANNEL_PREFIX: Record<SlackChannelKind, string> = {
  scoping: "l-scoping-",
  project: "l-project-",
};

/**
 * Visibility per kind. A scoping channel is private (commercial discussion
 * before a deal is public knowledge); a project channel is public so anyone in
 * the business can follow delivery. This drives `is_private` on create, and it
 * is why the two kinds have such different discoverability — Slack only lets our
 * bot see private channels it has been added to.
 */
export const SLACK_CHANNEL_IS_PRIVATE: Record<SlackChannelKind, boolean> = {
  scoping: true,
  project: false,
};

/** Slack's hard cap on a channel name. */
export const SLACK_CHANNEL_NAME_MAX = 80;

/**
 * A linked channel, as the UI consumes it. `url` is built server-side (it needs
 * `SLACK_TEAM_ID`) so no client ever has to know about the env var.
 */
export type SlackChannelRef = {
  /** Slack's channel id, e.g. `C0123ABCD`. The durable half of the link. */
  id: string;
  /** Bare channel name, no leading `#`. A display snapshot — may be stale. */
  name: string;
  url: string;
};

/**
 * Turn arbitrary text into something Slack will accept in a channel name:
 * lowercase, letters/digits/hyphens only, no leading, trailing or repeated
 * hyphens. Accents are folded rather than dropped, so "Café Group" becomes
 * `cafe-group` and not `caf-group`.
 *
 * Can legitimately return `""` — a name of only punctuation or emoji has no
 * slug. Callers must handle that; {@link buildSlackChannelName} does.
 */
export function slugifyChannelName(value: string): string {
  return (
    value
      .normalize("NFKD")
      // Strip the combining marks the decomposition leaves behind (e + U+0301).
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

/**
 * Marker put in front of channels created outside production, so a developer
 * exercising the create flow can't be mistaken for the real thing — and so the
 * junk is trivially sortable and sweepable in Slack.
 *
 * Applied only when **creating** ({@link buildSlackChannelCreateName}). Linking an
 * existing channel never adds or requires it, and the canonical name used for
 * matching never carries it.
 */
export const SLACK_TEST_CHANNEL_PREFIX = "test-";

/**
 * The **canonical** channel name for a record: its kind prefix plus a slug of the
 * source name (the opportunity name for `scoping`, the project name for
 * `project`).
 *
 * This is the name used for *matching* — the yardstick suggestions score against.
 * It deliberately never carries the non-production marker, so a dev environment
 * still recognises the real channels it's comparing itself to. Use
 * {@link buildSlackChannelCreateName} for the name actually sent to Slack.
 *
 * Two edge cases this exists to absorb, both of which Slack would otherwise
 * reject with a user-facing error:
 *
 * - **Length.** The 80-char cap covers the prefix too, so the slug is budgeted
 *   against it and any hyphen left dangling by the cut is trimmed.
 * - **An unsluggable name.** A record called "★" or "(TBD)" slugs to `""`, which
 *   would produce a bare `l-scoping-` and an `invalid_name` from Slack. We fall
 *   back to the record's own id, which is always alphanumeric.
 */
export function buildSlackChannelName(
  kind: SlackChannelKind,
  sourceName: string,
  fallbackId: string,
): string {
  return buildName(kind, sourceName, fallbackId, "");
}

/**
 * The name to actually **create** in Slack: the canonical name, prefixed with
 * `test-` anywhere but production.
 *
 * Both the dialog's read-only preview and `createSlackChannel` call this, so what
 * someone is shown is exactly what gets made — including the marker. It reads
 * `process.env.NODE_ENV` directly (as `logger.ts` and `auth/admin.ts` do) rather
 * than `@/env`, because this module is client-importable and Next inlines that one
 * value identically on both sides — which is what keeps preview and reality equal.
 */
export function buildSlackChannelCreateName(
  kind: SlackChannelKind,
  sourceName: string,
  fallbackId: string,
): string {
  const leader =
    process.env.NODE_ENV === "production" ? "" : SLACK_TEST_CHANNEL_PREFIX;
  return buildName(kind, sourceName, fallbackId, leader);
}

function buildName(
  kind: SlackChannelKind,
  sourceName: string,
  fallbackId: string,
  leader: string,
): string {
  const prefix = `${leader}${SLACK_CHANNEL_PREFIX[kind]}`;
  // The marker eats into the same 80 characters, so budget against the whole lead.
  const budget = SLACK_CHANNEL_NAME_MAX - prefix.length;

  const fromName = truncateSlug(slugifyChannelName(sourceName), budget);
  if (fromName) return `${prefix}${fromName}`;

  const fromId = truncateSlug(slugifyChannelName(fallbackId), budget);
  // Both empty is unreachable in practice (ids are CUID2, so alphanumeric), but
  // returning a prefix with nothing after it would be a guaranteed Slack error —
  // so keep the name valid and let the caller's own guard speak instead.
  return fromId ? `${prefix}${fromId}` : `${prefix}channel`;
}

/** Cut a slug to `max` chars without leaving a trailing hyphen behind. */
function truncateSlug(slug: string, max: number): string {
  if (slug.length <= max) return slug;
  return slug.slice(0, max).replace(/-+$/g, "");
}

/**
 * A deep link that opens the channel in the user's Slack client (falling back to
 * the web app). Keyed on the channel **id**, so a rename in Slack never breaks
 * it — which is what lets us treat the stored name as a throwaway snapshot.
 *
 * `teamId` is optional: without it, someone signed into several workspaces can
 * land in the wrong one.
 */
export function slackChannelUrl(channelId: string, teamId?: string): string {
  const params = new URLSearchParams({ channel: channelId });
  if (teamId) params.set("team", teamId);
  return `https://slack.com/app_redirect?${params.toString()}`;
}

/** Display form: `#l-project-acme`. Idempotent if the `#` is already there. */
export function formatSlackChannel(name: string): string {
  return `#${stripChannelHash(name)}`;
}

function stripChannelHash(name: string): string {
  return name.startsWith("#") ? name.slice(1) : name;
}

/**
 * Reduce a channel name to its distinguishing slug: drop the `#`, the
 * non-production marker, and the kind prefix.
 *
 * The marker is stripped so a `test-` channel made in dev still scores against the
 * real ones — otherwise every dev-created channel would look unrelated to the
 * record that created it.
 */
function stripChannelPrefix(name: string): string {
  let bare = stripChannelHash(name);
  if (bare.startsWith(SLACK_TEST_CHANNEL_PREFIX)) {
    bare = bare.slice(SLACK_TEST_CHANNEL_PREFIX.length);
  }
  for (const prefix of Object.values(SLACK_CHANNEL_PREFIX)) {
    if (bare.startsWith(prefix)) return bare.slice(prefix.length);
  }
  return bare;
}

/**
 * How confident are we that `candidate` is the channel a record is missing?
 * `0` (unrelated) to `1` (the name we would have generated).
 *
 * Both names have their convention prefix stripped first, which is the whole
 * trick: `l-project-acme` and `l-project-zeta` share ten leading characters, so
 * scoring the raw names would rate every project channel a decent match for
 * every other one.
 *
 * The measure is Sørensen–Dice over character bigrams — cheap, no dependency,
 * and tolerant of the word-order and truncation differences that real channel
 * names have. One adjustment on top: when one slug wholly contains the other
 * (`acme` inside `acme-platform-build`, the common "we shortened it" case) Dice
 * scores it far too low, so the result is floored.
 */
export function scoreSlackChannelMatch(
  candidate: string,
  expected: string,
): number {
  const a = stripChannelPrefix(candidate);
  const b = stripChannelPrefix(expected);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const dice = diceCoefficient(a, b);
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  // Guard the length: a 1–2 char containment ("a" in "acme-platform") is noise.
  const contained = shorter.length >= 3 && longer.includes(shorter);
  return contained ? Math.max(dice, CONTAINMENT_SCORE) : dice;
}

/** Floor applied when one slug contains the other. */
const CONTAINMENT_SCORE = 0.7;

/**
 * The score at or above which we'll propose a channel unprompted. Set so a
 * substring match clears it and a merely-similar name doesn't — a wrong
 * suggestion is worse than none, since acting on it links the wrong channel.
 */
export const SLACK_CHANNEL_MATCH_THRESHOLD = 0.7;

function diceCoefficient(a: string, b: string): number {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.length === 0 || right.length === 0) return 0;

  // Multiset intersection: consume each matched bigram so a repeated one in the
  // candidate can't match the same occurrence twice.
  const pool = new Map<string, number>();
  for (const gram of left) pool.set(gram, (pool.get(gram) ?? 0) + 1);

  let shared = 0;
  for (const gram of right) {
    const remaining = pool.get(gram) ?? 0;
    if (remaining > 0) {
      pool.set(gram, remaining - 1);
      shared += 1;
    }
  }

  return (2 * shared) / (left.length + right.length);
}

function bigrams(value: string): string[] {
  const grams: string[] = [];
  for (let i = 0; i < value.length - 1; i += 1) {
    grams.push(value.slice(i, i + 2));
  }
  return grams;
}
