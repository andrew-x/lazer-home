"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";

/**
 * The shared sign-out flow behind both call sites (the sidebar footer and the
 * `SignOutButton`). Better Auth's `signOut()` returns `{ error }` on a handled
 * failure and can reject outright on a network error — either way we must *not*
 * navigate to `/login` (that would look like a successful sign-out) and must
 * clear the loading state so the button doesn't hang. Only a clean result
 * redirects. `finally` guarantees the loading flag is always released.
 */
export function useSignOut() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function signOut() {
    setIsSigningOut(true);
    try {
      const { error } = await authClient.signOut();
      if (error) {
        toast.error(error.message ?? "Could not sign out. Please try again.");
        return;
      }
      router.replace("/login");
      router.refresh();
    } catch {
      toast.error("Could not sign out. Please try again.");
    } finally {
      setIsSigningOut(false);
    }
  }

  return { signOut, isSigningOut };
}
