import {
  IconCalendar,
  IconClock,
  IconTrendingUp,
  IconUsers,
} from "@tabler/icons-react";
import type { Metadata } from "next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/auth";

export const metadata: Metadata = { title: "Home" };

const STATS = [
  { label: "Active clients", value: "—", hint: "CRM", icon: IconUsers },
  {
    label: "People allocated",
    value: "—",
    hint: "Allocations",
    icon: IconCalendar,
  },
  { label: "Hours this week", value: "—", hint: "Timesheets", icon: IconClock },
  {
    label: "Utilization",
    value: "—",
    hint: "Performance",
    icon: IconTrendingUp,
  },
];

export default async function HomePage() {
  const user = await getCurrentUser();
  const firstName = user?.name?.split(" ")[0] ?? "there";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Welcome back, {firstName}
        </h2>
        <p className="text-muted-foreground">
          Here's the state of the consultancy at a glance.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardDescription className="text-xs font-medium uppercase tracking-wider">
                {stat.label}
              </CardDescription>
              <stat.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">
                {stat.value}
              </div>
              <p className="text-xs text-muted-foreground">{stat.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Getting started</CardTitle>
          <CardDescription>
            This is a scaffolded home. Domain dashboards (CRM, allocations,
            timesheets, performance) land here as they're built.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Use the sidebar to navigate. Your profile and session live in
          Settings.
        </CardContent>
      </Card>
    </div>
  );
}
