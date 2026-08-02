import type { ReactNode } from "react";

/**
 * One band of the home dashboard: a heading and one-line description over a
 * hairline rule, then the widgets.
 *
 * Deliberately not tabs (this is a glance surface — hiding half of it behind
 * client state defeats the point) and deliberately not a wrapping `Card`, since
 * `Card` already carries its own `ring-1` edge and the widgets inside are cards
 * themselves.
 */
export function HomeSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 border-b pb-3">
        <h3 className="font-heading text-lg font-semibold tracking-tight">
          {title}
        </h3>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
