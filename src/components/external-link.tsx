import type { ComponentProps } from "react";
import { cn } from "@/lib/core/utils";

/**
 * Anchor to an external URL. Opens in a new tab and always carries the standard
 * `rel="noopener noreferrer"` (so the new tab can't reach `window.opener`) plus
 * the app's link styling. Extra `className`s merge with the defaults, and any
 * other anchor props pass through. Use for every external (new-tab) link so the
 * rel, target, and styling stay consistent in one place.
 */
export function ExternalLink({ className, ...props }: ComponentProps<"a">) {
  return (
    <a
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "text-primary underline-offset-4 hover:underline",
        className,
      )}
      {...props}
    />
  );
}
