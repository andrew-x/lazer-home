"use client";

import { IconLogout } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useSignOut } from "@/hooks/useSignOut";

export function SignOutButton() {
  const { signOut, isSigningOut } = useSignOut();

  return (
    <Button
      type="button"
      variant="outline"
      className="gap-2"
      loading={isSigningOut}
      onClick={signOut}
    >
      {isSigningOut ? null : <IconLogout className="size-4" />}
      {isSigningOut ? "Signing out…" : "Sign out"}
    </Button>
  );
}
