import "server-only";

import { requirePermission } from "@/lib/auth/permissions";
import type { ActionAuthorize } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { slackChannelKindSchema } from "./slackChannel.schema";
import { SLACK_CHANNEL_TARGETS } from "./slackChannelLink";

/**
 * The gate for every Slack channel action: the capability follows the record
 * being written. A scoping channel is a column on `opportunities`, so it needs
 * `crm.edit`; a project channel is a column on `projects`, so it needs
 * `projects.edit`.
 *
 * Why this is an `authorize` hook and not a static `metadata.permission`: the two
 * capabilities are *disjoint* in the role matrix — `sales` holds only `crm.edit`,
 * `delivery-manager` only `projects.edit` — so there is no single static
 * capability that covers both kinds without granting one role access it shouldn't
 * have. This is exactly the input-dependent case `ActionAuthorize` exists for, and
 * it needs no new capability, so the permission matrix is untouched.
 *
 * `clientInput` is raw and pre-validation, so `kind` is parsed here rather than
 * trusted. An unparseable kind is **denied**, not skipped: a hook that returns
 * early when it can't read its own discriminant is a bypass, since the body would
 * then run ungated.
 */
export const authorizeSlackChannel: ActionAuthorize = ({
  user,
  clientInput,
}) => {
  const kind = slackChannelKindSchema.safeParse(
    (clientInput as { kind?: unknown } | null)?.kind,
  );
  if (!kind.success) {
    throw new UserSafeActionError("You don't have permission to do that.");
  }
  requirePermission(user, SLACK_CHANNEL_TARGETS[kind.data].permission);
};
