"use client";

import { IconPencil, IconTrash } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { type ReactNode, useId, useState } from "react";
import { createTask } from "@/actions/crm/createTask";
import { deleteTask } from "@/actions/crm/deleteTask";
import type { TaskView } from "@/actions/crm/getTasks";
import { searchStaff } from "@/actions/crm/searchStaff";
import { setTaskDone } from "@/actions/crm/setTaskDone";
import { TASK_MAX_LENGTH } from "@/actions/crm/tasks.schema";
import { updateTask } from "@/actions/crm/updateTask";
import { EntityCombobox } from "@/components/form/entity-combobox";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/core/utils";
import { formatShortDate } from "@/lib/format/format";

type TaskListProps = {
  /** Which parent the tasks hang off — selects the create action's parent kind. */
  variant: "contact" | "company" | "opportunity";
  parentId: string;
  tasks: TaskView[];
  canEdit: boolean;
  /**
   * The signed-in user's own staff `{ id, name }`, used to prefill the composer's
   * owner picker (the default owner). Null when the user has no staff record.
   */
  currentStaff: EntityOption | null;
  /**
   * Called after any successful mutation so a client-fetched parent (the
   * opportunity drawer) can re-load. Server-rendered pages also get a
   * `router.refresh()`, which picks up the action's `revalidatePath`.
   */
  onChanged?: () => void;
};

/** Turn a task's nullable owner id + name into an `EntityOption` for the picker. */
function ownerOption(task: TaskView): EntityOption | null {
  return task.ownerId
    ? { id: task.ownerId, name: task.ownerName ?? task.ownerId }
    : null;
}

/**
 * The labelled task fields — a single-line description input beside an owner
 * staff-picker on one row (stacking below `sm`). Shared by the composer and the
 * inline editor so both capture a task the same way. `trailing` holds the row's
 * end control (the composer's Add button); Enter in the description submits.
 */
function TaskFields({
  description,
  onDescriptionChange,
  owner,
  onOwnerChange,
  onSubmit,
  autoFocus,
  trailing,
}: {
  description: string;
  onDescriptionChange: (next: string) => void;
  owner: EntityOption | null;
  onOwnerChange: (next: EntityOption | null) => void;
  onSubmit: () => void;
  autoFocus?: boolean;
  trailing?: ReactNode;
}) {
  const descriptionId = useId();
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex flex-1 flex-col gap-1.5">
        <Label htmlFor={descriptionId}>Next step</Label>
        <Input
          id={descriptionId}
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder="What's the next step?"
          maxLength={TASK_MAX_LENGTH}
          autoFocus={autoFocus}
        />
      </div>
      <div className="flex flex-col gap-1.5 sm:w-56">
        <Label>Owner</Label>
        <EntityCombobox
          value={owner}
          onChange={onOwnerChange}
          searchAction={searchStaff}
          placeholder="Assign to…"
        />
      </div>
      {trailing}
    </div>
  );
}

/**
 * A parent's tasks: a composer (description + owner, owner defaulting to the
 * current user) plus the task list — a checkbox to complete, the description
 * (struck through once done), owner and dates, and inline edit/delete for CRM
 * editors. Open tasks sort first (server-ordered), completed ones below. Both the
 * detail pages and the opportunity drawer share this; `variant` picks the parent.
 */
export function TaskList({
  variant,
  parentId,
  tasks,
  canEdit,
  currentStaff,
  onChanged,
}: TaskListProps) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [draftOwner, setDraftOwner] = useState<EntityOption | null>(
    currentStaff,
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editOwner, setEditOwner] = useState<EntityOption | null>(null);
  const [pendingDoneId, setPendingDoneId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = () => {
    onChanged?.();
    router.refresh();
  };

  const create = useAction(createTask, {
    onSuccess: () => {
      setDraft("");
      setDraftOwner(currentStaff);
      refresh();
    },
  });
  const update = useAction(updateTask, {
    onSuccess: () => {
      setEditingId(null);
      refresh();
    },
  });
  const toggle = useAction(setTaskDone, {
    onSettled: () => setPendingDoneId(null),
    onSuccess: refresh,
  });
  const remove = useAction(deleteTask, {
    onSettled: () => setDeletingId(null),
    onSuccess: refresh,
  });

  const submitAdd = () => {
    const description = draft.trim();
    if (!description) return;
    create.execute({
      parent: { kind: variant, id: parentId },
      description,
      ownerId: draftOwner?.id ?? null,
    });
  };

  const submitEdit = () => {
    if (!editingId) return;
    const description = editDraft.trim();
    if (!description) return;
    update.execute({
      id: editingId,
      description,
      ownerId: editOwner?.id ?? null,
    });
  };

  const startEdit = (task: TaskView) => {
    setEditingId(task.id);
    setEditDraft(task.description);
    setEditOwner(ownerOption(task));
  };

  const toggleDone = (task: TaskView) => {
    setPendingDoneId(task.id);
    toggle.execute({ id: task.id, done: !task.done });
  };

  return (
    <div className="flex flex-col gap-4">
      {canEdit ? (
        <div className="flex flex-col gap-2">
          <TaskFields
            description={draft}
            onDescriptionChange={setDraft}
            owner={draftOwner}
            onOwnerChange={setDraftOwner}
            onSubmit={submitAdd}
            trailing={
              <Button
                type="button"
                onClick={submitAdd}
                disabled={!draft.trim()}
                loading={create.isPending}
              >
                Add next step
              </Button>
            }
          />
          {create.result.serverError ? (
            <p className="text-sm text-destructive">
              {create.result.serverError}
            </p>
          ) : null}
        </div>
      ) : null}

      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No next steps yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {tasks.map((task) => {
            const editing = editingId === task.id;
            return (
              <li
                key={task.id}
                className="group flex flex-col gap-1.5 border-l-2 pl-3"
              >
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={task.done}
                    onCheckedChange={() => toggleDone(task)}
                    disabled={!canEdit || pendingDoneId === task.id}
                    aria-label={
                      task.done ? "Reopen next step" : "Complete next step"
                    }
                    className="mt-0.5"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    {editing ? (
                      <div className="flex flex-col gap-2">
                        <TaskFields
                          description={editDraft}
                          onDescriptionChange={setEditDraft}
                          owner={editOwner}
                          onOwnerChange={setEditOwner}
                          onSubmit={submitEdit}
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
                      <>
                        <p
                          className={cn(
                            "whitespace-pre-wrap text-sm",
                            task.done && "text-muted-foreground line-through",
                          )}
                        >
                          {task.description}
                        </p>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span>{task.ownerName ?? "Unassigned"}</span>
                          <span>·</span>
                          <span>
                            {task.done && task.completedAt
                              ? `Done ${formatShortDate(new Date(task.completedAt))}`
                              : formatShortDate(new Date(task.createdAt))}
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {canEdit && !editing ? (
                    <span
                      className={cn(
                        "ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100",
                        deletingId === task.id && "opacity-100",
                      )}
                    >
                      <IconButton
                        label="Edit next step"
                        onClick={() => startEdit(task)}
                      >
                        <IconPencil />
                      </IconButton>
                      <IconButton
                        label="Delete next step"
                        loading={deletingId === task.id}
                        onClick={() => {
                          setDeletingId(task.id);
                          remove.execute({ id: task.id });
                        }}
                      >
                        <IconTrash />
                      </IconButton>
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
