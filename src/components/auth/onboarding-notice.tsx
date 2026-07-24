import type { ReactNode } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { LogoMark } from "@/components/brand/logo";

/**
 * Full-screen, login-styled notice for users who are authenticated but can't
 * enter the app yet (no/incomplete staff profile). Server component; the only
 * action is signing out to switch accounts.
 */
export function OnboardingNotice({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 px-6">
      <LogoMark size={36} priority />
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <h1 className="font-heading text-xl font-semibold tracking-tight">
          {title}
        </h1>
        <div className="text-sm text-muted-foreground">{children}</div>
        <SignOutButton />
      </div>
    </main>
  );
}
