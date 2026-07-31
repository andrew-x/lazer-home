"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useId, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { createProjectDeliveryNote } from "@/actions/projects/createProjectDeliveryNote";
import { deleteProjectDeliveryNote } from "@/actions/projects/deleteProjectDeliveryNote";
import {
  type DeliveryNoteContentInput,
  type DeliveryNoteContentValues,
  deliveryNoteContentSchema,
} from "@/actions/projects/deliveryNotes.schema";
import type { ProjectDeliveryNoteRow } from "@/actions/projects/getProjectDeliveryNotes";
import { updateProjectDeliveryNote } from "@/actions/projects/updateProjectDeliveryNote";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FormField } from "@/components/form/form-field";
import { StarRating } from "@/components/form/star-rating";
import { InternalLink } from "@/components/internal-link";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatIsoDate } from "@/lib/format/format";
import {
  DELIVERY_NOTE_HINT,
  DELIVERY_NOTE_TITLE_PLACEHOLDER,
} from "@/lib/projects/delivery-note";
import {
  PROJECT_HEALTH_MAX,
  projectHealthLabel,
} from "@/lib/projects/project-health";

/**
 * The form shape behind both the composer and the editor — identical, because the
 * ids (`projectId` on create, `noteId` on edit) are supplied at submit rather than
 * typed by anyone. Same arrangement as `ReviewNoteForm`.
 */
type DeliveryNoteFormValues = DeliveryNoteContentInput;

/**
 * The **Delivery notes** tab on a project: dated write-ups of how the engagement is
 * going, each carrying its author's 1–10 health rating. The newest note's rating is
 * what the projects list shows and what the **Low health** tag is drawn from, so
 * this is the surface that moves that badge.
 *
 * Reads are open — anyone who can see the project can read its notes. Writing,
 * editing and deleting are all the one static `projects.edit` capability, decided
 * server-side and passed in as `canEdit`; this component only renders the
 * affordances it was told about and never its own permission logic. Notably an
 * editor need not be the author: a delivery note is the operational record of a
 * shared engagement, so the team that runs it can correct it (ADR 0059).
 */
export function DeliveryNotesPanel({
  projectId,
  notes,
  canEdit,
}: {
  projectId: string;
  notes: ProjectDeliveryNoteRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ProjectDeliveryNoteRow | null>(null);

  const remove = useAction(deleteProjectDeliveryNote, {
    onSuccess: () => {
      toast.success("Note deleted.");
      setDeleting(null);
      router.refresh();
    },
    onError: ({ error }) => {
      toast.error(error.serverError ?? "Couldn't delete that note.");
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">{DELIVERY_NOTE_HINT}</p>
        {canEdit && !composing ? (
          <Button size="sm" onClick={() => setComposing(true)}>
            <IconPlus />
            New note
          </Button>
        ) : null}
      </div>

      {composing ? (
        <div className="rounded-md border p-4">
          <DeliveryNoteForm
            projectId={projectId}
            onSaved={() => {
              setComposing(false);
              router.refresh();
            }}
            onCancel={() => setComposing(false)}
          />
        </div>
      ) : null}

      {notes.length === 0 && !composing ? (
        <EmptyState bordered>No delivery notes on this project yet.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {notes.map((note) => (
            <li key={note.id} className="rounded-md border p-4">
              {editingId === note.id ? (
                <DeliveryNoteForm
                  note={note}
                  onSaved={() => {
                    setEditingId(null);
                    router.refresh();
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        {note.title ?? formatDate(note.noteDate)}
                      </span>
                      <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        {note.title ? (
                          <span>{formatDate(note.noteDate)}</span>
                        ) : null}
                        {note.authorName ? (
                          <>
                            {note.title ? <span>·</span> : null}
                            <span>
                              by{" "}
                              {note.authorStaffId ? (
                                <InternalLink
                                  href={`/staff/${note.authorStaffId}`}
                                >
                                  {note.authorName}
                                </InternalLink>
                              ) : (
                                note.authorName
                              )}
                            </span>
                          </>
                        ) : null}
                        {note.updatedAt > note.createdAt ? (
                          <>
                            <span>·</span>
                            <span>edited</span>
                          </>
                        ) : null}
                      </span>
                    </div>

                    {canEdit ? (
                      <div className="flex shrink-0 items-center gap-1">
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

                  {/* Stars are safe here, unlike on the list card: no wrapping
                      link, and one rating per row rather than per grid cell. */}
                  <div className="flex items-center gap-2">
                    <StarRating
                      label="Project health"
                      max={PROJECT_HEALTH_MAX}
                      value={note.projectHealth}
                      readOnly
                    />
                    <span className="text-xs text-muted-foreground">
                      {note.projectHealth}/{PROJECT_HEALTH_MAX} ·{" "}
                      {projectHealthLabel(note.projectHealth)}
                    </span>
                  </div>

                  <p className="text-sm whitespace-pre-wrap">{note.body}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete this delivery note?"
        description="This note will be permanently deleted. If it's the project's most recent one, the health shown on the projects list falls back to the note before it."
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
 * actions need — see {@link DeliveryNoteFormValues}. Both actions' hooks are
 * instantiated every render (stable hook order) and the mode picks between them,
 * the same way `ReviewNoteForm` and `SelfEvaluationForm` do.
 *
 * Create takes the `projectId`, edit takes the `note` — a union rather than two
 * optional props, so "neither", which would submit into the void, can't be
 * constructed.
 */
function DeliveryNoteForm(
  props: { onSaved: () => void; onCancel: () => void } & (
    | { projectId: string; note?: never }
    | { note: ProjectDeliveryNoteRow; projectId?: never }
  ),
) {
  const { note, onSaved, onCancel } = props;
  const fieldId = useId();
  // The star currently hovered/focused, so the label below can describe a level
  // before it's committed — a 10-point scale is hard to read without it. Lifted
  // from `InlineRelationshipStrengthField`.
  const [preview, setPreview] = useState<number | null>(null);

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
    // The third generic is the *transformed* shape `handleSubmit` receives: the
    // schema trims and maps a blank title to null, so the submit handler already
    // has exactly what the actions take.
  } = useForm<DeliveryNoteFormValues, unknown, DeliveryNoteContentValues>({
    resolver: zodResolver(deliveryNoteContentSchema),
    defaultValues: {
      noteDate: note?.noteDate ?? formatIsoDate(new Date()),
      title: note?.title ?? "",
      body: note?.body ?? "",
      // Left unset when composing, so an unrated note fails validation with "Rate
      // the project's health." rather than defaulting someone into a judgement
      // they didn't make. Same treatment as `selfRating`.
      projectHealth: note?.projectHealth,
    },
  });

  const create = useAction(createProjectDeliveryNote, {
    onSuccess: () => {
      toast.success("Delivery note saved.");
      onSaved();
    },
  });
  const update = useAction(updateProjectDeliveryNote, {
    onSuccess: () => {
      toast.success("Note updated.");
      onSaved();
    },
  });

  const active = note ? update : create;

  const onSubmit = handleSubmit((values) => {
    if (props.note) update.execute({ noteId: props.note.id, ...values });
    else create.execute({ projectId: props.projectId, ...values });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        <FormField
          label="Date"
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
            placeholder={DELIVERY_NOTE_TITLE_PLACEHOLDER}
            aria-invalid={Boolean(errors.title)}
            {...register("title")}
          />
        </FormField>
      </div>

      <Controller
        control={control}
        name="projectHealth"
        render={({ field, fieldState }) => (
          <FormField label="Project health" error={fieldState.error?.message}>
            <div className="flex items-center gap-2">
              <StarRating
                label="Project health"
                max={PROJECT_HEALTH_MAX}
                value={field.value ?? null}
                onChange={field.onChange}
                onPreviewChange={setPreview}
              />
              <span className="text-xs text-muted-foreground">
                {projectHealthLabel(preview ?? field.value ?? null)}
              </span>
            </div>
          </FormField>
        )}
      />

      <FormField
        label="Notes"
        htmlFor={`${fieldId}-body`}
        error={errors.body?.message}
      >
        <Textarea
          id={`${fieldId}-body`}
          rows={10}
          className="min-h-48"
          placeholder="How is delivery going, what's at risk, and what happens next…"
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
          Save
        </Button>
      </div>
    </form>
  );
}
