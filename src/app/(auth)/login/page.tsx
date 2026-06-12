import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { LogoMark } from "@/components/brand/logo";
import { getCurrentUser } from "@/lib/auth";
import { APP_NAME } from "@/lib/constants";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 px-6">
      <div className="flex flex-col items-center gap-3">
        <LogoMark size={36} />
        <h1 className="font-heading text-xl font-semibold tracking-tight">
          {APP_NAME}
        </h1>
      </div>
      <div className="w-full max-w-xs">
        <GoogleSignInButton />
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Lazer staff only.
        </p>
      </div>
    </main>
  );
}
