import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingNotice } from "@/components/auth/onboarding-notice";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Profile setup" };

/**
 * Post-login block screen for users who can't enter the app yet. One page, two
 * messages: no active staff record vs. an active record missing employment
 * info. Self-gates (no group layout) — users who are set up are bounced home.
 */
export default async function ProfileSetupPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const staffAccess = await getCurrentStaff(user);
  if (staffAccess.status === "ok") redirect("/");

  if (staffAccess.status === "incomplete") {
    return (
      <OnboardingNotice title="Your profile is incomplete">
        <p>
          Your staff profile is missing employment information, so we can’t
          finish signing you in. Please contact Andrew to complete your setup.
        </p>
      </OnboardingNotice>
    );
  }

  return (
    <OnboardingNotice title="Your profile isn’t set up yet">
      <p>
        We couldn’t find an active staff profile for{" "}
        <span className="text-foreground">{user.email}</span>. Please contact
        Andrew to get set up.
      </p>
    </OnboardingNotice>
  );
}
