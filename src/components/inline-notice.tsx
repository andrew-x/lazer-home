import type { Icon } from "@tabler/icons-react";
import { IconInfoCircle } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/core/utils";

/**
 * A non-blocking inline notice: a hairline-bordered strip with a leading icon.
 *
 * The app has no `Alert` primitive, and this shape was open-coded in three places
 * (the timesheet week's two banners, and now the budget form's mixed-currency
 * warning), so it lives here once. Deliberately *not* a form error: it never sets
 * `aria-invalid`, never blocks a submit, and carries no field association — it is
 * derived state the reader should know about, not something to fix.
 *
 * `tone` only ever escalates to `destructive`; there is no success/info colour,
 * because the design language keeps in-page surfaces monochrome and reserves
 * colour for genuine problems.
 *
 * **Not a Client Component, deliberately** — it holds no state, no handlers and no
 * browser API, so it renders on the server. It used to carry `"use client"`, which
 * made `icon` (a component *reference*) unpassable from a Server Component: React
 * cannot serialize a function across that boundary, so the home page's
 * "no staff record" branch crashed with "Functions cannot be passed directly to
 * Client Components". Client callers can still import it — a plain module used by a
 * `"use client"` module is simply bundled into that chunk. Don't re-add the
 * directive.
 */
export function InlineNotice({
  icon: Icon = IconInfoCircle,
  tone = "muted",
  className,
  children,
}: {
  icon?: Icon;
  tone?: "muted" | "destructive";
  className?: string;
  children: ReactNode;
}) {
  const destructive = tone === "destructive";
  return (
    <div
      className={cn(
        "flex w-full items-start gap-2 rounded-md border px-3 py-2 text-sm",
        destructive
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "bg-muted/40",
        className,
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          destructive ? undefined : "text-muted-foreground",
        )}
      />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
