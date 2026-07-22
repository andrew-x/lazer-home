"use client";

import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";
import { updateContactRelationshipStrength } from "@/actions/crm/updateContactRelationshipStrength";
import { StarRating } from "@/components/form/star-rating";
import { Label } from "@/components/ui/label";
import { relationshipStrengthLabel } from "@/lib/crm/relationship-strength";

/**
 * The contact's relationship strength, edited in place in the meta sidebar: a
 * 1–5 star rating with the current level's label beneath it. Unlike the owner
 * field there's no pencil/confirm step — clicking a star *is* the edit, so it
 * writes immediately via `updateContactRelationshipStrength` (which
 * `revalidatePath`s the detail route). Optimistic local state keeps the stars in
 * sync while the write is in flight and reverts on error. Read-only stars when
 * the viewer lacks `crm.edit`.
 */
export function InlineRelationshipStrengthField({
  contactId,
  canEdit,
  strength,
}: {
  contactId: string;
  canEdit: boolean;
  strength: number | null;
}) {
  const [value, setValue] = useState<number | null>(strength);
  const [preview, setPreview] = useState<number | null>(null);

  const { execute, isPending } = useAction(updateContactRelationshipStrength, {
    onError: ({ error }) => {
      setValue(strength);
      toast.error(
        error.serverError ?? "Couldn't update the relationship strength.",
      );
    },
    onSuccess: () => toast.success("Relationship strength updated."),
  });

  const handleChange = (next: number) => {
    setValue(next);
    execute({ id: contactId, relationshipStrength: next });
  };

  const described = preview ?? value;

  return (
    <div className="flex flex-col gap-2.5">
      <Label>Relationship</Label>
      <div className="flex flex-col gap-1">
        <StarRating
          label="Relationship strength"
          value={value}
          onChange={canEdit ? handleChange : undefined}
          onPreviewChange={setPreview}
          readOnly={!canEdit}
          disabled={isPending}
        />
        <p className="text-xs text-muted-foreground">
          {relationshipStrengthLabel(described)}
        </p>
      </div>
    </div>
  );
}
