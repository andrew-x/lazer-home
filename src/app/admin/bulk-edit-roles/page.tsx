import type { Metadata } from "next";
import { staffDirectoryFilterOptions } from "@/actions/staff/getStaffDirectory";
import { getStaffEmploymentForEdit } from "@/actions/staff/getStaffEmploymentForEdit";
import { BulkEditRoles } from "@/components/admin/bulk-edit-roles";

export const metadata: Metadata = { title: "Bulk edit roles" };

export default async function BulkEditRolesPage() {
  const rows = await getStaffEmploymentForEdit();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Bulk edit roles
        </h2>
        <p className="text-muted-foreground">
          Edit staff employment facts across the team. Leave the effective date
          blank to correct each person's current record in place, or set a date
          to add a new effective-dated record.
        </p>
      </div>

      <BulkEditRoles
        rows={rows}
        lineOfBusinessOptions={staffDirectoryFilterOptions.lineOfBusiness}
        roleOptions={staffDirectoryFilterOptions.role}
        employmentTypeOptions={staffDirectoryFilterOptions.employmentType}
        billableTypeOptions={staffDirectoryFilterOptions.billableType}
      />
    </div>
  );
}
