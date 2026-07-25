"use client";

import { useState } from "react";
import { EnumSelect } from "@/components/form/enum-select";
import { InlineEditField } from "@/components/form/inline-edit-field";
import {
  LINE_OF_BUSINESS,
  LINE_OF_BUSINESS_LABELS,
  type LineOfBusiness,
} from "@/lib/crm/line-of-business";
import { type FieldProps, useInlineSave } from "../use-inline-save";

export function LineOfBusinessField({ detail, refresh }: FieldProps) {
  const save = useInlineSave(detail, refresh);
  const [draft, setDraft] = useState<LineOfBusiness | "">(
    detail.lineOfBusiness,
  );
  return (
    <InlineEditField
      label="Line of business"
      display={LINE_OF_BUSINESS_LABELS[detail.lineOfBusiness]}
      editing={save.editing}
      isSaving={save.isPending}
      error={save.error}
      onEdit={() => {
        setDraft(detail.lineOfBusiness);
        save.open();
      }}
      onCancel={save.close}
      // Guard the commit so an empty draft can't be sent as a valid enum; the
      // confirm is a no-op until a value is picked. `draft` narrows to
      // `LineOfBusiness` past the guard, so no cast is needed.
      onConfirm={() => {
        if (!draft) return;
        save.commit({ field: "lineOfBusiness", lineOfBusiness: draft });
      }}
    >
      <EnumSelect
        options={LINE_OF_BUSINESS}
        labels={LINE_OF_BUSINESS_LABELS}
        placeholder="Select a line of business"
        value={draft}
        invalid={Boolean(save.error)}
        onValueChange={setDraft}
      />
    </InlineEditField>
  );
}
