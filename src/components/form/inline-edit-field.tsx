"use client";

import { IconCheck, IconPencil, IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { FormField } from "@/components/form/form-field";
import { IconButton } from "@/components/icon-button";

/**
 * A single detail field that reads as plain text until edited in place. Read mode
 * shows the value plus a pencil; edit mode swaps in the control (`children`) with
 * confirm/cancel buttons. `editing` is controlled by the caller so the field can
 * stay open on a validation error and close only once its (async) save actually
 * succeeds. The label row reuses `FormField`'s `labelAction` slot for the
 * affordances, so these rows line up with the other form primitives.
 */
export function InlineEditField({
  label,
  display,
  children,
  editing,
  canEdit = true,
  isSaving = false,
  error,
  editAction,
  onEdit,
  onCancel,
  onConfirm,
}: {
  label: string;
  display: ReactNode;
  children?: ReactNode;
  editing: boolean;
  canEdit?: boolean;
  isSaving?: boolean;
  error?: string;
  /** Extra control shown in the label row while editing (e.g. a "New contact" button). */
  editAction?: ReactNode;
  onEdit: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <FormField
      label={label}
      // Only surface the field's error while it's the one being edited.
      error={editing ? error : undefined}
      labelAction={
        canEdit ? (
          editing ? (
            <div className="flex items-center gap-0.5">
              {editAction}
              <IconButton
                label={`Save ${label}`}
                onClick={onConfirm}
                loading={isSaving}
              >
                <IconCheck />
              </IconButton>
              <IconButton
                label={`Cancel editing ${label}`}
                onClick={onCancel}
                disabled={isSaving}
              >
                <IconX />
              </IconButton>
            </div>
          ) : (
            <IconButton label={`Edit ${label}`} onClick={onEdit}>
              <IconPencil />
            </IconButton>
          )
        ) : null
      }
    >
      {editing ? (
        children
      ) : (
        <div className="min-h-8 py-1 text-sm">{display}</div>
      )}
    </FormField>
  );
}
