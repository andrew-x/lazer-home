"use client";

import { IconRefresh } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/auth-client";
import { DRIVE_SCOPE } from "@/lib/drive/scope";

/**
 * Re-grant Drive access without signing out.
 *
 * Two situations need this, and they are the same fix:
 *
 * - Anyone who signed in *before* Drive scope was added to the login. Changing
 *   the provider config grants nothing retroactively, so their existing session
 *   is valid but cannot touch Drive.
 * - Anyone who revoked the app in their Google account settings, or whose refresh
 *   token stopped working.
 *
 * `linkSocial` on the already-linked Google account is the documented incremental
 * -consent path, and Better Auth's Google provider sends
 * `include_granted_scopes`, so this ADDS Drive to the existing grant rather than
 * replacing it. Crucially it is not a sign-out: the session survives, so nobody
 * loses their place in the app to fix this.
 */
export function DriveReconnectButton({
  label = "Reconnect Google Drive",
}: {
  label?: string;
}) {
  const [pending, setPending] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      loading={pending}
      onClick={async () => {
        setPending(true);
        const { error } = await authClient.linkSocial({
          provider: "google",
          scopes: [DRIVE_SCOPE],
        });
        if (error) {
          toast.error(error.message ?? "Couldn't start the Google reconnect.");
          setPending(false);
          return;
        }
        // On success the browser navigates to Google, so `pending` is
        // deliberately left set — clearing it would flash the button back to its
        // resting state during the redirect.
      }}
    >
      <IconRefresh />
      {label}
    </Button>
  );
}
