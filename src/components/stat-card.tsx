import type { Icon } from "@tabler/icons-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";

/**
 * The app's KPI tile: an uppercase label, an optional icon, a large numeric value,
 * and an optional hint line. One tile shared by every surface that shows headline
 * numbers — the home dashboard, the three performance dashboards, and the
 * project/opportunity plan summaries.
 *
 * `value` is pre-formatted by the caller (use `formatPercent` / the currency
 * formatters), so an unknown figure reads as "—" rather than a hand-rolled dash.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: IconComponent,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: Icon;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardDescription className="text-xs font-medium uppercase tracking-wider">
          {label}
        </CardDescription>
        {IconComponent && (
          <IconComponent className="size-4 text-muted-foreground" />
        )}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
