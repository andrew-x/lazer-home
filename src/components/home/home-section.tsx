import type { ReactNode } from "react";

/**
 * One band of the home dashboard: a heading and one-line description over a
 * hairline rule, then the widgets.
 *
 * The section is deliberately not a wrapping `Card` — `Card` already carries its
 * own `ring-1` edge and the widgets inside are cards themselves.
 *
 * `action` holds a control that scopes the **whole** band (Lazer Status puts its
 * line-of-business filter there). Keep per-widget controls inside their own card;
 * this slot is reserved for something that changes every figure below it, so the
 * reader can see at a glance what the section is scoped to.
 */
export function HomeSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b pb-3">
        <div className="flex flex-col gap-1">
          <h3 className="font-heading text-lg font-semibold tracking-tight">
            {title}
          </h3>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
