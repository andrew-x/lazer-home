"use client";

import { IconPlus } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { type ReactElement, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { createTask } from "@/actions/crm/createTask";
import { deleteTask } from "@/actions/crm/deleteTask";
import type { OpenTaskSummary } from "@/actions/crm/getTasks";
import { setTaskDone } from "@/actions/crm/setTaskDone";
import { updateTask } from "@/actions/crm/updateTask";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/core/utils";
import { OpenTasksCell } from "./open-tasks-cell";
import { TaskFields } from "./task-fields";
import { TaskOwnerAvatar } from "./task-owner-avatar";

/** Errors surface as toasts — a table cell has no room for inline error text. */
function toastError({ error }: { error: { serverError?: string } }) {
  toast.error(error.serverError ?? "Something went wrong.");
}

/** Turn a summary's nullable owner id + name into an `EntityOption` for the picker. */
function ownerOption(task: OpenTaskSummary): EntityOption | null {
  return task.ownerId
    ? { id: task.ownerId, name: task.ownerName ?? task.ownerId }
    : null;
}

/**
 * The shared editor surface — {@link TaskFields} plus its actions — shown inside
 * a popover so the table row stays one line tall. `secondary` holds the edit
 * popover's Delete button.
 */
function TaskEditorPopover({
  open,
  onOpenChange,
  trigger,
  description,
  onDescriptionChange,
  owner,
  onOwnerChange,
  onSubmit,
  submitLabel,
  pending,
  secondary,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** The element the popover hangs off — Base UI's `render` prop takes an element, not arbitrary nodes. */
  trigger: ReactElement;
  description: string;
  onDescriptionChange: (next: string) => void;
  owner: EntityOption | null;
  onOwnerChange: (next: EntityOption | null) => void;
  onSubmit: () => void;
  submitLabel: string;
  pending: boolean;
  secondary?: ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" className="w-80">
        <TaskFields
          stacked
          description={description}
          onDescriptionChange={onDescriptionChange}
          owner={owner}
          onOwnerChange={onOwnerChange}
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
          autoFocus
        />
        <div className="flex items-center justify-end gap-2">
          {secondary ? <div className="mr-auto">{secondary}</div> : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSubmit}
            disabled={!description.trim()}
            loading={pending}
          >
            {submitLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One task: a single compact line of `checkbox · description · owner`. While
 * open, the description is the trigger for an edit popover, so editing (and
 * deleting) never expands the row. Once completed the row sticks around struck
 * through — unticking it reopens the task — so a mis-click is one click to undo.
 * Completed rows aren't editable: the list only fetches open tasks, so the cell
 * is holding the last copy it saw and an edit would silently drift from the row.
 *
 * Each row owns its own action hooks deliberately: `useAction` keeps a single
 * in-flight request id and drops the result of any superseded call, so a
 * cell-wide hook shared by every row would swallow the first task's error (and
 * clear its pending state) the moment you touched a second one. Per-row hooks
 * also make "busy" just `isPending` — no id bookkeeping.
 */
function ContactTaskRow({
  task,
  done,
  onDoneChange,
}: {
  task: OpenTaskSummary;
  done: boolean;
  /** Hands the completed/reopened task back so the cell can keep rendering it. */
  onDoneChange: (task: OpenTaskSummary, done: boolean) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.description);
  const [owner, setOwner] = useState<EntityOption | null>(ownerOption(task));

  const update = useAction(updateTask, {
    onSuccess: () => {
      setEditing(false);
      router.refresh();
    },
    onError: toastError,
  });
  const toggle = useAction(setTaskDone, {
    onSuccess: () => {
      onDoneChange(task, !done);
      router.refresh();
    },
    onError: toastError,
  });
  const remove = useAction(deleteTask, {
    onSuccess: () => {
      setEditing(false);
      router.refresh();
    },
    onError: toastError,
  });

  const submitEdit = () => {
    const description = draft.trim();
    if (!description) return;
    update.execute({ id: task.id, description, ownerId: owner?.id ?? null });
  };

  // Show the destination state while the toggle is in flight, so the tick and
  // the strike-through land on click rather than after the round-trip.
  const struck = toggle.isPending ? !done : done;

  return (
    <div className="flex items-center gap-2">
      <Checkbox
        checked={struck}
        onCheckedChange={() => toggle.execute({ id: task.id, done: !done })}
        disabled={toggle.isPending}
        aria-label={
          done
            ? `Reopen "${task.description}"`
            : `Complete "${task.description}"`
        }
        className="size-3.5 shrink-0"
      />
      {done ? (
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground line-through">
          {task.description}
        </span>
      ) : (
        <TaskEditorPopover
          open={editing}
          onOpenChange={(next) => {
            // Re-seed from the row on open so a cancelled edit doesn't linger.
            if (next) {
              setDraft(task.description);
              setOwner(ownerOption(task));
            }
            setEditing(next);
          }}
          trigger={
            <button
              type="button"
              aria-label={`Edit "${task.description}"`}
              className={cn(
                "min-w-0 flex-1 truncate text-left text-xs hover:underline",
                struck && "text-muted-foreground line-through",
              )}
            >
              {task.description}
            </button>
          }
          description={draft}
          onDescriptionChange={setDraft}
          owner={owner}
          onOwnerChange={setOwner}
          onSubmit={submitEdit}
          submitLabel="Save"
          pending={update.isPending}
          secondary={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              loading={remove.isPending}
              onClick={() => remove.execute({ id: task.id })}
            >
              Delete
            </Button>
          }
        />
      )}
      <TaskOwnerAvatar name={task.ownerName} />
    </div>
  );
}

/**
 * The contacts list's "Next steps" cell, worked in place: each open task is one
 * compact line — tick the checkbox to complete it, click the text to edit or
 * delete it in a popover — plus an "Add" affordance that opens the same popover
 * empty.
 *
 * A completed task drops out of the server data immediately (the list only
 * fetches open tasks), so the cell holds on to the ones completed during this
 * visit and keeps rendering them below the open ones, struck through, as a
 * one-click undo. They're session-scoped: a navigation or hard reload clears
 * them, which is the intended lifetime for an undo affordance.
 *
 * Read-only (the shared {@link OpenTasksCell}) for users without `crm.edit`; the
 * task actions enforce that server-side regardless, `canEdit` only decides what
 * to render.
 */
export function ContactTasksCell({
  contactId,
  tasks,
  canEdit,
  currentStaff,
}: {
  contactId: string;
  tasks: OpenTaskSummary[];
  canEdit: boolean;
  /** The signed-in user's own staff `{ id, name }` — the composer's default owner. */
  currentStaff: EntityOption | null;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftOwner, setDraftOwner] = useState<EntityOption | null>(
    currentStaff,
  );
  // Tasks whose done-state this cell changed during the visit, keyed by id. The
  // server list only carries *open* tasks and lags a `router.refresh()` behind
  // every toggle, so these overrides paper over both directions of the gap:
  // a just-completed task is still in `tasks` (render it struck, not twice), and
  // a just-reopened one has dropped out of the local pile but hasn't come back
  // in `tasks` yet (keep rendering it, so undo doesn't blink the row away).
  const [overrides, setOverrides] = useState<
    Map<string, { task: OpenTaskSummary; done: boolean }>
  >(new Map());

  const create = useAction(createTask, {
    onSuccess: () => {
      setDraft("");
      setDraftOwner(currentStaff);
      setAdding(false);
      router.refresh();
    },
    onError: toastError,
  });

  if (!canEdit) {
    return <OpenTasksCell tasks={tasks} />;
  }

  const submitAdd = () => {
    const description = draft.trim();
    if (!description) return;
    create.execute({
      parent: { kind: "contact", id: contactId },
      description,
      ownerId: draftOwner?.id ?? null,
    });
  };

  const onDoneChange = (task: OpenTaskSummary, done: boolean) =>
    setOverrides((current) => new Map(current).set(task.id, { task, done }));

  const serverIds = new Set(tasks.map((task) => task.id));
  const open = [
    ...tasks.filter((task) => !overrides.get(task.id)?.done),
    // Reopened but not yet back in the server list.
    ...[...overrides.values()]
      .filter((entry) => !entry.done && !serverIds.has(entry.task.id))
      .map((entry) => entry.task),
  ];
  const completed = [...overrides.values()]
    .filter((entry) => entry.done)
    .map((entry) => entry.task);

  return (
    <div className="flex min-w-56 flex-col gap-1">
      {open.map((task) => (
        <ContactTaskRow
          key={task.id}
          task={task}
          done={false}
          onDoneChange={onDoneChange}
        />
      ))}
      {completed.map((task) => (
        <ContactTaskRow
          key={task.id}
          task={task}
          done
          onDoneChange={onDoneChange}
        />
      ))}

      <TaskEditorPopover
        open={adding}
        onOpenChange={(next) => {
          if (!next) {
            setDraft("");
            setDraftOwner(currentStaff);
          }
          setAdding(next);
        }}
        trigger={
          <button
            type="button"
            className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <IconPlus className="size-3.5" />
            Add
          </button>
        }
        description={draft}
        onDescriptionChange={setDraft}
        owner={draftOwner}
        onOwnerChange={setDraftOwner}
        onSubmit={submitAdd}
        submitLabel="Add"
        pending={create.isPending}
      />
    </div>
  );
}
