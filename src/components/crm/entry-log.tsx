"use client";

import { IconPencil, IconTrash } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { addContactEntry } from "@/actions/crm/addContactEntry";
import { addOpportunityEntry } from "@/actions/crm/addOpportunityEntry";
import { deleteContactEntry } from "@/actions/crm/deleteContactEntry";
import { deleteOpportunityEntry } from "@/actions/crm/deleteOpportunityEntry";
import { type EntryKind, maxLengthForKind } from "@/actions/crm/entries.schema";
import type { EntryView } from "@/actions/crm/entryViews";
import { updateContactEntry } from "@/actions/crm/updateContactEntry";
import { updateOpportunityEntry } from "@/actions/crm/updateOpportunityEntry";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";

type EntryLogProps = {
  /** Which parent the entries hang off — selects the action set. */
  variant: "contact" | "opportunity";
  parentId: string;
  kind: EntryKind;
  entries: EntryView[];
  canEdit: boolean;
  /**
   * Called after any successful mutation so a client-fetched parent (the
   * opportunity drawer) can re-load. Server-rendered pages also get a
   * `router.refresh()`, which picks up the action's `revalidatePath`.
   */
  onChanged?: () => void;
};

const COPY: Record<
  EntryKind,
  { placeholder: string; addLabel: string; empty: string }
> = {
  note: {
    placeholder: "Add a note…",
    addLabel: "Add note",
    empty: "No notes yet.",
  },
  next_step: {
    placeholder: "Add a next step…",
    addLabel: "Add next step",
    empty: "No next steps yet.",
  },
};

/**
 * A running log of timestamped, authored entries of one `kind` (notes or next
 * steps) for a contact or opportunity. Newest first, each with author + time.
 * CRM editors get a composer plus inline edit/delete on every entry (no per-entry
 * ownership — any editor may amend any entry). Both parents share this component;
 * `variant` picks the matching action set.
 */
export function EntryLog({
  variant,
  parentId,
  kind,
  entries,
  canEdit,
  onChanged,
}: EntryLogProps) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const copy = COPY[kind];
  const maxLength = maxLengthForKind(kind);

  const refresh = () => {
    onChanged?.();
    router.refresh();
  };

  // Both add hooks are created every render (stable order); `variant` picks which
  // one is used, keeping each action's input strictly typed.
  const addContact = useAction(addContactEntry, {
    onSuccess: () => {
      setDraft("");
      refresh();
    },
  });
  const addOpportunity = useAction(addOpportunityEntry, {
    onSuccess: () => {
      setDraft("");
      refresh();
    },
  });
  const add = variant === "contact" ? addContact : addOpportunity;

  // Update and delete share one schema across both parents, so a ternary on the
  // action reference keeps a single, consistently-typed hook each.
  const update = useAction(
    variant === "contact" ? updateContactEntry : updateOpportunityEntry,
    {
      onSuccess: () => {
        setEditingId(null);
        setEditDraft("");
        refresh();
      },
    },
  );
  const remove = useAction(
    variant === "contact" ? deleteContactEntry : deleteOpportunityEntry,
    {
      onSettled: () => setDeletingId(null),
      onSuccess: refresh,
    },
  );

  const submitAdd = () => {
    const body = draft.trim();
    if (!body) return;
    if (variant === "contact") {
      addContact.execute({ contactId: parentId, kind, body });
    } else {
      addOpportunity.execute({ opportunityId: parentId, kind, body });
    }
  };

  const submitEdit = () => {
    if (!editingId) return;
    update.execute({ id: editingId, kind, body: editDraft.trim() });
  };

  const startEdit = (entry: EntryView) => {
    setEditingId(entry.id);
    setEditDraft(entry.body);
  };

  return (
    <div className="flex flex-col gap-4">
      {canEdit ? (
        <div className="flex flex-col gap-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={copy.placeholder}
            maxLength={maxLength}
            rows={kind === "note" ? 3 : 2}
          />
          <div className="flex items-center justify-between gap-3">
            {add.result.serverError ? (
              <p className="text-sm text-destructive">
                {add.result.serverError}
              </p>
            ) : (
              <span />
            )}
            <Button
              type="button"
              size="sm"
              onClick={submitAdd}
              disabled={!draft.trim()}
              loading={add.isPending}
            >
              {copy.addLabel}
            </Button>
          </div>
        </div>
      ) : null}

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => {
            const editing = editingId === entry.id;
            return (
              <li
                key={entry.id}
                className="flex flex-col gap-1.5 border-l-2 pl-3"
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {entry.authorName ?? "Unknown"}
                  </span>
                  <span>·</span>
                  <span>{formatDateTime(new Date(entry.createdAt))}</span>
                  {entry.editedAt ? <span>· edited</span> : null}
                  {canEdit && !editing ? (
                    <span className="ml-auto flex items-center gap-0.5">
                      <IconButton
                        label="Edit entry"
                        onClick={() => startEdit(entry)}
                      >
                        <IconPencil />
                      </IconButton>
                      <IconButton
                        label="Delete entry"
                        loading={deletingId === entry.id}
                        onClick={() => {
                          setDeletingId(entry.id);
                          remove.execute({ id: entry.id });
                        }}
                      >
                        <IconTrash />
                      </IconButton>
                    </span>
                  ) : null}
                </div>

                {editing ? (
                  <div className="flex flex-col gap-2">
                    <Textarea
                      value={editDraft}
                      onChange={(event) => setEditDraft(event.target.value)}
                      maxLength={maxLength}
                      rows={kind === "note" ? 3 : 2}
                      autoFocus
                    />
                    {update.result.serverError ? (
                      <p className="text-sm text-destructive">
                        {update.result.serverError}
                      </p>
                    ) : null}
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingId(null)}
                        disabled={update.isPending}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={submitEdit}
                        disabled={!editDraft.trim()}
                        loading={update.isPending}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-sm">{entry.body}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
