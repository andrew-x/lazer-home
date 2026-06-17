import Image from "next/image";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** The brand mark from /public/icon.svg. Decorative — pair with the name for a11y. */
export function LogoMark({
  className,
  size = 24,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <Image
      src="/icon.svg"
      alt=""
      aria-hidden
      width={size}
      height={size}
      unoptimized
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

/** Mark + wordmark, used on the login screen and 404. */
export function Logo({
  className,
  showName = true,
}: {
  className?: string;
  showName?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-2 font-heading font-semibold",
        className,
      )}
    >
      <LogoMark />
      {showName && <span className="text-base tracking-tight">{APP_NAME}</span>}
    </span>
  );
}
