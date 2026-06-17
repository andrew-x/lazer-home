import type { Metadata } from "next";
import { getStaffDirectory } from "@/actions/staff/getStaffDirectory";
import { StaffDirectory } from "@/components/staff/staff-directory";
import {
  employmentTypeEnum,
  lineOfBusinessEnum,
  roleEnum,
} from "@/lib/db/schema";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage() {
  const entries = await getStaffDirectory();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header>
        <h2 className="font-heading text-xl font-semibold tracking-tight">
          Staff
        </h2>
        <p className="text-sm text-muted-foreground">
          Browse the team. Search and filter to find someone.
        </p>
      </header>
      <StaffDirectory
        entries={entries}
        lineOfBusinessOptions={[...lineOfBusinessEnum.enumValues]}
        roleOptions={[...roleEnum.enumValues]}
        typeOptions={[...employmentTypeEnum.enumValues]}
      />
    </div>
  );
}
