import Image from "next/image";
import { APP_NAME } from "@/lib/core/constants";
import { cn } from "@/lib/core/utils";

/** The brand mark from /public/icon.svg. Decorative — pair with the name for a11y. */
export function LogoMark({
  className,
  size = 24,
  priority = false,
}: {
  className?: string;
  size?: number;
  /** Set on above-the-fold instances (e.g. login) so it isn't lazy-loaded as the LCP. */
  priority?: boolean;
}) {
  return (
    <Image
      src="/icon.svg"
      alt=""
      aria-hidden
      width={size}
      height={size}
      unoptimized
      priority={priority}
      className={cn("select-none", className)}
    />
  );
}

/** The full logo lockup from /public/logo.svg (mark + wordmark as one image). */
export function LogoWordmark({
  className,
  height = 24,
}: {
  className?: string;
  height?: number;
}) {
  // logo.svg is 1895×750; preserve that aspect ratio off the requested height.
  return (
    <Image
      src="/logo.svg"
      alt={APP_NAME}
      width={Math.round(height * (1895 / 750))}
      height={height}
      unoptimized
      className={cn("select-none", className)}
    />
  );
}
