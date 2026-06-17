import type { Metadata } from "next";
import { StaffImport } from "@/components/admin/staff-import";

export const metadata: Metadata = { title: "Upload staff" };

export default function UploadStaffPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Upload staff
        </h2>
        <p className="text-muted-foreground">
          Pick a Rippling CSV export. Rows are parsed and matched against
          existing staff by Rippling ID; review the changes before saving.
        </p>
      </div>

      <StaffImport />
    </div>
  );
}
