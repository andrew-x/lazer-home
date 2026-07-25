"use client";

import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import type { OpportunityDetail } from "@/actions/crm/getOpportunity";
import { updateOpportunityField } from "@/actions/crm/updateOpportunityField";
import {
  type UpdateOpportunityFieldInput,
  updateOpportunityFieldSchema,
} from "@/actions/crm/updateOpportunityField.schema";

/** Shared props for every inline field editor: the loaded detail + a refetch. */
export type FieldProps = { detail: OpportunityDetail; refresh: () => void };

/**
 * One field's edit payload — a `updateOpportunityField` variant minus the `id`,
 * which `commit` fills from the loaded detail. A distributive `Omit` so it stays
 * a discriminated union (each variant keeps only its own keys).
 */
type FieldEdit = UpdateOpportunityFieldInput extends infer T
  ? T extends { id: string }
    ? Omit<T, "id">
    : never
  : never;

/**
 * Per-field edit state + save. Each field owns its own instance so pending and
 * error are isolated. `commit` sends *only* the changed field's slice via the
 * field-scoped `updateOpportunityField` — so a save never clobbers a concurrent
 * edit to another field or needlessly rewrites the other people junctions — and
 * closes the field on success. A client-side `safeParse` surfaces the field's
 * own validation message before the round-trip; `fail` lets a field report a
 * guard failure directly.
 */
export function useInlineSave(detail: OpportunityDetail, refresh: () => void) {
  const [editing, setEditing] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const { execute, result, isPending, reset } = useAction(
    updateOpportunityField,
    {
      onSuccess: () => {
        setEditing(false);
        refresh();
      },
    },
  );

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
    fail: (message: string) => setClientError(message),
    commit: (edit: FieldEdit) => {
      setClientError(null);
      const parsed = updateOpportunityFieldSchema.safeParse({
        ...edit,
        id: detail.id,
      });
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
