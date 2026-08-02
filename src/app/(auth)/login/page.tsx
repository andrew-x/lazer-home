import type { Metadata } from "next";
import { Architects_Daughter } from "next/font/google";
import { redirect } from "next/navigation";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { LogoMark } from "@/components/brand/logo";
import { getCurrentUser } from "@/lib/auth/auth";
import { APP_NAME } from "@/lib/core/constants";

// The annotation's handwriting. Loaded in this module rather than the root
// layout so it only ships on /login — it's the one screen that uses it.
const marker = Architects_Daughter({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-marker",
});

export const metadata: Metadata = { title: "Sign in" };

/**
 * The login screen is the only surface that isn't product chrome, so it's the
 * one place the design language relaxes: a quiet dot-grid sheet with a single
 * hand-drawn annotation pointing at the button. Machine-precise type against
 * one pencil mark — the whimsy is the gesture, everything else stays flat and
 * monochrome. Don't add a second flourish (see docs/ui.md).
 */
export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <main
      className={`${marker.variable} relative flex min-h-svh flex-col items-center justify-center px-6 py-24`}
    >
      {/* Graph-paper ground, vignetted so it never reaches the edges. Uses the
          hairline --border grey, so the logo gradient stays the only colour. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--border) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          maskImage:
            "radial-gradient(ellipse 46% 42% at 50% 46%, #000 25%, transparent 78%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 46% 42% at 50% 46%, #000 25%, transparent 78%)",
        }}
      />

      <div className="relative z-10 flex flex-col items-center">
        <LogoMark size={56} priority />

        <h1 className="mt-5 font-heading text-4xl font-semibold tracking-[-0.03em]">
          {APP_NAME}
        </h1>

        {/* mt-40 clears the 96px ink layer that hangs above the button, and
            still leaves the note breathing room under the wordmark. */}
        <div className="group relative mt-40 w-full max-w-xs">
          <SignInAnnotation />
          <GoogleSignInButton />
        </div>
      </div>

      <p className="absolute inset-x-0 bottom-8 z-10 text-center text-xs text-muted-foreground">
        Any problems? Contact Andrew.
      </p>
    </main>
  );
}

/**
 * The ink layer: a handwritten note and an arrow pointing at the button.
 * Entirely decorative — `aria-hidden` because "sign in here" only restates the
 * button's own label, and a dangling phrase read aloud is noise.
 *
 * The 200×96 box is sized to match its viewBox 1:1, so the coordinates below are
 * literal pixels.
 */
function SignInAnnotation() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-full mb-2 flex justify-center"
    >
      <div className="relative h-24 w-[200px] transition-transform duration-300 ease-out group-has-[button:hover]:translate-y-1 motion-reduce:transition-none">
        <span className="absolute left-0 top-0 -rotate-6 font-[family-name:var(--font-marker)] text-lg leading-none text-ink">
          sign in here
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 200 96"
          fill="none"
          className="absolute inset-0 size-full overflow-visible stroke-ink"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        >
          <path d="M 98 22 C 122 28, 136 42, 134 58 C 132 72, 126 78, 120 84" />
          <path d="M 131 81 L 120 84 L 123 73" />
        </svg>
      </div>
    </div>
  );
}
