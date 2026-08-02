import type { Icon } from "@tabler/icons-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";

/**
 * A single KPI tile: an uppercase label, an optional icon, a large numeric value,
 * and an optional hint line. Extracted from the Home dashboard's inline pattern so
 * the performance dashboard (and future dashboards) share one stat tile.
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
