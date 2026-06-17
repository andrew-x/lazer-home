import type { Metadata } from "next";
import { PtoImport } from "@/components/admin/pto-import";

export const metadata: Metadata = { title: "Upload PTO" };

export default function UploadPtoPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Upload PTO
        </h2>
        <p className="text-muted-foreground">
          Pick a Rippling leave export. Rows are matched to staff by Employee -
          ID and to existing PTO by Leave request ID; rejected or cancelled
          requests are removed. Review the changes before saving.
        </p>
      </div>

      <PtoImport />
    </div>
  );
}
