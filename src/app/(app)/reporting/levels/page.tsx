import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getRatingsSummaryData } from "@/actions/performance/getRatingsSummaryData";
import { performanceFilterOptions } from "@/actions/staff/getCompensationSummaryData";
import { LevelsDashboard } from "@/components/performance/levels-dashboard";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";

export const metadata: Metadata = { title: "Levels" };

export default async function LevelsDashboardPage() {
  // Levels are stricter than compensation — manager/admin only (not finance).
  // 404 (rather than error) for unauthorized users, matching the hidden nav item;
  // the read gates on `ratings.view` again as defense in depth.
  const user = await getCurrentUser();
  if (!user || !userHasPermission(user, { ratings: ["view"] })) {
    notFound();
  }

  const records = await getRatingsSummaryData();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Levels dashboard
        </h2>
        <p className="text-muted-foreground">
          Staff levels (L0–L4) across the team. Visible to managers and admins
          only.
        </p>
      </div>

      <LevelsDashboard
        records={records}
        filterOptions={performanceFilterOptions}
      />
    </div>
  );
}
