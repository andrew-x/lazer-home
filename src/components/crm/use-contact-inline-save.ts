"use client";

import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { updateContactField } from "@/actions/crm/updateContactField";
import {
  type UpdateContactFieldInput,
  updateContactFieldSchema,
} from "@/actions/crm/updateContactField.schema";

/**
 * One field's edit payload — an `updateContactField` variant minus the `id`, which
 * `commit` fills in. A distributive `Omit` so it stays a discriminated union (each
 * variant keeps only its own keys).
 */
export type ContactFieldEdit = UpdateContactFieldInput extends infer T
  ? T extends { id: string }
    ? Omit<T, "id">
    : never
  : never;

/**
 * Per-field edit state + save for the contact detail sidebar — the contact
 * counterpart of `useProjectInlineSave`. Each field owns its own instance so
 * pending and error are isolated, and `commit` sends *only* that field's slice, so
 * a save never clobbers a concurrent edit to another field.
 *
 * The reason this exists (where `InlineLocationField`/`InlineOwnerField` hand-roll
 * `useState` + `useAction`) is the client-side `safeParse`: the fields it serves are
 * validated text — a malformed email or LinkedIn URL, an over-long phone — and
 * parsing against the field's own schema surfaces that message immediately instead
 * of after a round-trip. Those two fields stay hand-rolled because they're shared
 * with the company page and bind whichever entity's action `kind` selects, so they
 * can't take a contact-only hook.
 *
 * No `refresh` callback (unlike the opportunity drawer's `useInlineSave`): the
 * contact page is a Server Component and `updateContactField` revalidates its
 * route, so the rendered value refreshes itself on success.
 */
export function useContactInlineSave(contactId: string) {
  const [editing, setEditing] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const { execute, result, isPending, reset } = useAction(updateContactField, {
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
    /**
     * Drop the client-side validation message once the value changes, so "Enter a
     * valid email." doesn't sit under an address that's now fine. A *server* error
     * deliberately survives: it describes the attempt that was actually made, and
     * clearing it would mean `reset()`, which also drops `isPending` and would stop
     * the save button spinning mid-flight if the person kept typing.
     */
    clearError: () => setClientError(null),
    commit: (edit: ContactFieldEdit) => {
      setClientError(null);
      const parsed = updateContactFieldSchema.safeParse({
        ...edit,
        id: contactId,
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
