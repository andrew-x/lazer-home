"use server";

import { z } from "zod";
import { secureActionClient } from "@/lib/core/action";
import { isDriveConfigured } from "./driveApi";
import { requireDriveAccessToken } from "./driveToken";

/**
 * Hand the Google Picker an access token.
 *
 * The Picker runs entirely in the browser and `setOAuthToken` is the only way to
 * authorize it, so this is the one place a Drive token leaves the server. That is
 * inherent to using the Picker and is the acknowledged cost of not building our
 * own uploader (docs/decisions/0069) — the token is the signed-in person's own,
 * scoped to their own Drive access, and short-lived.
 *
 * **The signature is the security boundary.** It takes no input at all: the token
 * returned is always `ctx.user`'s, resolved from the session by the action layer.
 * Adding a `userId` parameter — even "just for admins" — would turn this into an
 * endpoint that hands one person a token for another person's entire Drive. If a
 * change ever needs that, it is not a refactor; stop and flag it.
 */
export const getDrivePickerToken = secureActionClient
  .metadata({ action: "get-drive-picker-token" })
  .inputSchema(z.object({}))
  .action(async ({ ctx: { user } }) => {
    if (!isDriveConfigured()) {
      return { accessToken: null, appId: null, apiKey: null };
    }

    const accessToken = await requireDriveAccessToken(user.id);

    // The Picker needs all three together, and the two public ones are returned
    // here rather than read from `process.env` in the component so a
    // half-configured install fails in one place with one message.
    return {
      accessToken,
      apiKey: process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY ?? null,
      appId: process.env.NEXT_PUBLIC_GOOGLE_PICKER_APP_ID ?? null,
    };
  });
