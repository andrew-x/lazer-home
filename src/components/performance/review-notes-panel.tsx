"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  IconLock,
  IconPencil,
  IconPlus,
  IconShare,
  IconTrash,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useId, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { createReviewNote } from "@/actions/performance/createReviewNote";
import { deleteReviewNote } from "@/actions/performance/deleteReviewNote";
import type {
  ReviewNoteRow,
  StaffReviewNotesView,
} from "@/actions/performance/getStaffReviewNotes";
import {
  type ReviewNoteContentInput,
  type ReviewNoteContentValues,
  reviewNoteContentSchema,
} from "@/actions/performance/reviewNotes.schema";
import { shareReviewNote } from "@/actions/performance/shareReviewNote";
import { updateReviewNote } from "@/actions/performance/updateReviewNote";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FormField } from "@/components/form/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  formatDate,
  formatIsoDate,
  formatShortDate,
} from "@/lib/format/format";
import {
  REVIEW_NOTE_DRAFT_HINT,
  REVIEW_NOTE_SHARE_WARNING,
  REVIEW_NOTE_STATUS_LABELS,
} from "@/lib/performance/review-note";

/**
 * The form shape behind both the composer and the editor — identical, because the
 * ids (`staffId` on create, `noteId` on edit) are supplied at submit rather than
 * typed by anyone. Mirrors the `RoleFields` pattern: one concrete values type
 * shared by two forms so they can't drift.
 */
type ReviewNoteFormValues = ReviewNoteContentInput;

/**
 * The **Review notes** tab on a staff profile: dated write-ups of review
 * conversations, each a draft until its author shares it with the person.
 *
 * Rendered on `/staff/[id]`, `/profile`, and inside the compensation-plan profile
 * drawer. What each viewer may see and do is decided server-side
 * (`getStaffReviewNotes` → `reviewNoteAccess`); this component only renders the
 * affordances it was told about — never its own permission logic.
 *
 * `onChanged` lets a client-fetched host (the drawer) re-load. Server-rendered
 * pages get `revalidatePath` from the actions plus the `router.refresh()` below;
 * the drawer must NOT refresh the route, or the plan editor it sits over would
 * re-render mid-edit.
 */
export function ReviewNotesPanel({
  staffId,
  staffName,
  view,
  onChanged,
}: {
  staffId: string;
  staffName: string;
  view: StaffReviewNotesView;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sharing, setSharing] = useState<ReviewNoteRow | null>(null);
  const [deleting, setDeleting] = useState<ReviewNoteRow | null>(null);

  function afterChange() {
    if (onChanged) onChanged();
    else router.refresh();
  }

  const share = useAction(shareReviewNote, {
    onSuccess: () => {
      toast.success(`Note shared with ${staffName}.`);
      setSharing(null);
      afterChange();
    },
    onError: ({ error }) => {
      toast.error(error.serverError ?? "Couldn't share that note.");
    },
  });

  const remove = useAction(deleteReviewNote, {
    onSuccess: () => {
      toast.success("Note deleted.");
      setDeleting(null);
      afterChange();
    },
    onError: ({ error }) => {
      toast.error(error.serverError ?? "Couldn't delete that note.");
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {view.isSubject
            ? "Notes your manager has shared with you from your review conversations. Only you and your manager can see them."
            : `Notes from review conversations with ${staffName}. ${REVIEW_NOTE_DRAFT_HINT}`}
        </p>
        {view.canCreate && !composing ? (
          <Button size="sm" onClick={() => setComposing(true)}>
            <IconPlus />
            New note
          </Button>
        ) : null}
      </div>

      {composing ? (
        <div className="rounded-md border p-4">
          <ReviewNoteForm
            staffId={staffId}
            onSaved={() => {
              setComposing(false);
              afterChange();
            }}
            onCancel={() => setComposing(false)}
          />
        </div>
      ) : null}

      {view.notes.length === 0 && !composing ? (
        <EmptyState bordered>
          {view.isSubject
            ? "Your manager hasn't shared any review notes with you yet."
            : `No review notes about ${staffName} yet.`}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {view.notes.map((note) => (
            <li key={note.id} className="rounded-md border p-4">
              {editingId === note.id ? (
                <ReviewNoteForm
                  note={note}
                  onSaved={() => {
                    setEditingId(null);
                    afterChange();
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {note.title ?? formatDate(note.noteDate)}
                        </span>
                        {note.status === "DRAFT" ? (
                          <Badge variant="outline">
                            <IconLock className="size-3" />
                            {REVIEW_NOTE_STATUS_LABELS.DRAFT}
                          </Badge>
                        ) : null}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {[
                          note.title ? formatDate(note.noteDate) : null,
                          note.authorName ? `by ${note.authorName}` : null,
                          note.sharedAt
                            ? `shared ${formatShortDate(note.sharedAt)}`
                            : null,
                          note.updatedAt > note.createdAt ? "edited" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>

                    {note.canManage ? (
                      <div className="flex shrink-0 items-center gap-1">
                        {note.status === "DRAFT" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSharing(note)}
                          >
                            <IconShare />
                            Share
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingId(note.id)}
                        >
                          <IconPencil />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleting(note)}
                        >
                          <IconTrash />
                          Delete
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  <p className="text-sm whitespace-pre-wrap">{note.body}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={sharing !== null}
        onOpenChange={(open) => {
          if (!open) setSharing(null);
        }}
        title={`Share this note with ${staffName}?`}
        description={REVIEW_NOTE_SHARE_WARNING}
        confirmLabel="Share"
        loading={share.isPending}
        onConfirm={() => {
          if (sharing) share.execute({ noteId: sharing.id });
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete this note?"
        description={
          deleting?.status === "SHARED"
            ? `${staffName} can currently read this note. Deleting it is the only way to take it back.`
            : "This draft will be permanently deleted."
        }
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (deleting) remove.execute({ noteId: deleting.id });
        }}
      />
    </div>
  );
}

/**
 * The composer/editor. Loose binding (`useForm` + `useAction`) rather than
 * `useHookFormAction`, because the form shape deliberately omits the ids the
 * actions need — see `ReviewNoteFormValues`. Both actions' hooks are instantiated
 * every render (stable hook order) and the mode picks between them, the same way
 * `EntryLog` chooses its variant's action set.
 *
 * Create takes the person's `staffId`, edit takes the `note` — a union rather than
 * two optional props, so "neither", which would submit into the void, can't be
 * constructed.
 */
function ReviewNoteForm(
  props: { onSaved: () => void; onCancel: () => void } & (
    | { staffId: string; note?: never }
    | { note: ReviewNoteRow; staffId?: never }
  ),
) {
  const { note, onSaved, onCancel } = props;
  const fieldId = useId();

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
    // The third generic is the *transformed* shape `handleSubmit` receives: the
    // schema trims and maps a blank title to null, so the submit handler already
    // has exactly what the actions take.
  } = useForm<ReviewNoteFormValues, unknown, ReviewNoteContentValues>({
    resolver: zodResolver(reviewNoteContentSchema),
    defaultValues: {
      noteDate: note?.noteDate ?? formatIsoDate(new Date()),
      title: note?.title ?? "",
      body: note?.body ?? "",
    },
  });

  const create = useAction(createReviewNote, {
    onSuccess: () => {
      toast.success("Draft saved. Share it when you're ready.");
      onSaved();
    },
  });
  const update = useAction(updateReviewNote, {
    onSuccess: () => {
      toast.success("Note updated.");
      onSaved();
    },
  });

  const active = note ? update : create;

  const onSubmit = handleSubmit((values) => {
    if (props.note) update.execute({ noteId: props.note.id, ...values });
    else create.execute({ staffId: props.staffId, ...values });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        <FormField
          label="Date of conversation"
          htmlFor={`${fieldId}-date`}
          error={errors.noteDate?.message}
          className="sm:w-56"
        >
          <Controller
            control={control}
            name="noteDate"
            render={({ field }) => (
              <DatePicker
                id={`${fieldId}-date`}
                className="w-full"
                value={field.value ?? null}
                onChange={(next) => field.onChange(next ?? "")}
              />
            )}
          />
        </FormField>

        <FormField
          label="Title"
          htmlFor={`${fieldId}-title`}
          error={errors.title?.message}
          className="flex-1 min-w-0"
        >
          <Input
            id={`${fieldId}-title`}
            placeholder="Optional — e.g. H2 review conversation"
            aria-invalid={Boolean(errors.title)}
            {...register("title")}
          />
        </FormField>
      </div>

      <FormField
        label="Notes"
        htmlFor={`${fieldId}-body`}
        error={errors.body?.message}
      >
        <Textarea
          id={`${fieldId}-body`}
          rows={10}
          className="min-h-48"
          placeholder="What was discussed, what was agreed, and what happens next…"
          aria-invalid={Boolean(errors.body)}
          {...register("body")}
        />
      </FormField>

      {active.result.serverError ? (
        <p className="text-sm text-destructive">{active.result.serverError}</p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={active.isPending}
        >
          Cancel
        </Button>
        <Button type="submit" loading={active.isPending}>
          {note ? "Save" : "Save draft"}
        </Button>
      </div>
    </form>
  );
}
