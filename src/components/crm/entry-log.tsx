"use client";

import { IconPencil, IconTrash } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { addCompanyEntry } from "@/actions/crm/addCompanyEntry";
import { addContactEntry } from "@/actions/crm/addContactEntry";
import { addOpportunityEntry } from "@/actions/crm/addOpportunityEntry";
import { deleteCompanyEntry } from "@/actions/crm/deleteCompanyEntry";
import { deleteContactEntry } from "@/actions/crm/deleteContactEntry";
import { deleteOpportunityEntry } from "@/actions/crm/deleteOpportunityEntry";
import { NOTE_MAX_LENGTH } from "@/actions/crm/entries.schema";
import type { EntryView } from "@/actions/crm/entryViews";
import { updateCompanyEntry } from "@/actions/crm/updateCompanyEntry";
import { updateContactEntry } from "@/actions/crm/updateContactEntry";
import { updateOpportunityEntry } from "@/actions/crm/updateOpportunityEntry";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/core/utils";
import { formatShortDate } from "@/lib/format/format";

type EntryLogProps = {
  /** Which parent the entries hang off — selects the action set. */
  variant: "contact" | "opportunity" | "company";
  parentId: string;
  entries: EntryView[];
  canEdit: boolean;
  /**
   * Called after any successful mutation so a client-fetched parent (the
   * opportunity drawer) can re-load. Server-rendered pages also get a
   * `router.refresh()`, which picks up the action's `revalidatePath`.
   */
  onChanged?: () => void;
};

/**
 * A running log of timestamped, authored notes for a contact, company, or
 * opportunity. Newest first, each with author + time. CRM editors get a composer
 * plus inline edit/delete on every note (no per-entry ownership — any editor may
 * amend any note). All three parents share this component; `variant` picks the
 * matching action set.
 */
export function EntryLog({
  variant,
  parentId,
  entries,
  canEdit,
  onChanged,
}: EntryLogProps) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
  const addCompany = useAction(addCompanyEntry, {
    onSuccess: () => {
      setDraft("");
      refresh();
    },
  });
  const add =
    variant === "contact"
      ? addContact
      : variant === "opportunity"
        ? addOpportunity
        : addCompany;

  // Update and delete share one schema across all parents, so a ternary on the
  // action reference keeps a single, consistently-typed hook each.
  const update = useAction(
    variant === "contact"
      ? updateContactEntry
      : variant === "opportunity"
        ? updateOpportunityEntry
        : updateCompanyEntry,
    {
      onSuccess: () => {
        setEditingId(null);
        setEditDraft("");
        refresh();
      },
    },
  );
  const remove = useAction(
    variant === "contact"
      ? deleteContactEntry
      : variant === "opportunity"
        ? deleteOpportunityEntry
        : deleteCompanyEntry,
    {
      onSettled: () => setDeletingId(null),
      onSuccess: refresh,
    },
  );

  const submitAdd = () => {
    const body = draft.trim();
    if (!body) return;
    if (variant === "contact") {
      addContact.execute({ contactId: parentId, body });
    } else if (variant === "opportunity") {
      addOpportunity.execute({ opportunityId: parentId, body });
    } else {
      addCompany.execute({ companyId: parentId, body });
    }
  };

  const submitEdit = () => {
    if (!editingId) return;
    update.execute({ id: editingId, body: editDraft.trim() });
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
            placeholder="Add a note…"
            maxLength={NOTE_MAX_LENGTH}
            rows={3}
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
              Add note
            </Button>
          </div>
        </div>
      ) : null}

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => {
            const editing = editingId === entry.id;
            return (
              <li
                key={entry.id}
                className="group flex flex-col gap-1.5 border-l-2 pl-3"
              >
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{formatShortDate(new Date(entry.createdAt))}</span>
                  {/* Author (and any edited marker) is secondary — revealed only
                      on hover/focus so the timeline reads by date. */}
                  <span className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    · {entry.authorName ?? "Unknown"}
                    {entry.editedAt ? " · edited" : null}
                  </span>
                  {canEdit && !editing ? (
                    <span
                      className={cn(
                        "ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100",
                        deletingId === entry.id && "opacity-100",
                      )}
                    >
                      <IconButton
                        label="Edit note"
                        onClick={() => startEdit(entry)}
                      >
                        <IconPencil />
                      </IconButton>
                      <IconButton
                        label="Delete note"
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
                      maxLength={NOTE_MAX_LENGTH}
                      rows={3}
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
