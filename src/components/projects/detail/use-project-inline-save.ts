"use client";

import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { updateProjectField } from "@/actions/projects/updateProjectField";
import {
  type UpdateProjectFieldInput,
  updateProjectFieldSchema,
} from "@/actions/projects/updateProjectField.schema";

/**
 * One field's edit payload — an `updateProjectField` variant minus the `projectId`,
 * which `commit` fills in. A distributive `Omit` so it stays a discriminated union
 * (each variant keeps only its own keys).
 */
type FieldEdit = UpdateProjectFieldInput extends infer T
  ? T extends { projectId: string }
    ? Omit<T, "projectId">
    : never
  : never;

/**
 * Per-field edit state + save for the project detail sidebar. Each field owns its
 * own instance so pending and error are isolated. `commit` sends *only* the changed
 * field's slice via the field-scoped `updateProjectField` — so a save never clobbers
 * a concurrent edit to another field, nor needlessly rewrites the delivery-manager
 * junction — and closes the field on success. A client-side `safeParse` surfaces the
 * field's own validation message before the round-trip.
 *
 * Unlike the opportunity drawer's `useInlineSave` this takes no `refresh` callback:
 * that drawer loads its data client-side, whereas this page is a Server Component
 * passing `plan` down as a prop, so the action's `revalidatePath` on the detail route
 * is what refreshes the rendered values (the company/contact inline-field mechanism).
 */
export function useProjectInlineSave(projectId: string) {
  const [editing, setEditing] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const { execute, result, isPending, reset } = useAction(updateProjectField, {
    onSuccess: () => setEditing(false),
  });

  return {
    editing,
    isPending,
    error: clientError ?? result.serverError ?? undefined,
    open: () => {
      setClientError(null);
      reset();
      setEditing(true);
    },
    close: () => {
      setClientError(null);
      reset();
      setEditing(false);
    },
    commit: (edit: FieldEdit) => {
      setClientError(null);
      const parsed = updateProjectFieldSchema.safeParse({ ...edit, projectId });
      if (!parsed.success) {
        // The payload only carries this field's keys, so any issue is this
        // field's — surface the first.
        const issue = parsed.error.issues[0];
        setClientError(issue?.message ?? "Please check this value.");
        return;
      }
      execute(parsed.data);
    },
  };
}
