import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/core/utils";

/**
 * Next.js `<Link>` carrying the app's standard link styling — the internal-nav
 * counterpart to `ExternalLink`. Use it for every in-app navigation link so the
 * `text-primary` / hover-underline treatment lives in one place. Extra
 * `className`s merge with the defaults; all other `Link` props pass through.
 */
export function InternalLink({
  className,
  ...props
}: ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn(
        "text-primary underline-offset-4 hover:underline",
        className,
      )}
      {...props}
    />
  );
}
