import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";
import { requiredText } from "@/lib/schemas/text-schema";

/**
 * Shared validation for tasks — assignable, completable to-dos on a CRM entity.
 * A pure, client-importable module so the composer form and the actions share
 * one schema. (Tasks replaced the old free-text "next step" entry.)
 */
export const TASK_MAX_LENGTH = 1000;

const description = requiredText(TASK_MAX_LENGTH);

/** The CRM entity a task hangs off — exactly one per task. */
export const TASK_PARENT_KINDS = ["company", "contact", "opportunity"] as const;
export const taskParentKindSchema = z.enum(TASK_PARENT_KINDS);
export type TaskParentKind = (typeof TASK_PARENT_KINDS)[number];

/** Which parent a task attaches to. All parents are `{ id }`; `kind` selects the FK. */
export const taskParentSchema = z.object({ kind: taskParentKindSchema, id });
export type TaskParent = z.infer<typeof taskParentSchema>;

// `ownerId` is optional on create — the action defaults it to the creator's own
// staff id when omitted (the composer sends the current user by default).
export const createTaskSchema = z.object({
  parent: taskParentSchema,
  description,
  ownerId: id.nullable().optional(),
});
export type CreateTaskInput = z.input<typeof createTaskSchema>;

// Edits the description and reassigns the owner; never changes the parent.
export const updateTaskSchema = z.object({
  id,
  description,
  ownerId: id.nullable(),
});
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;

// The done toggle. The action stamps/clears `completedAt` from `done`.
export const setTaskDoneSchema = z.object({ id, done: z.boolean() });
export type SetTaskDoneInput = z.input<typeof setTaskDoneSchema>;

export const deleteTaskSchema = z.object({ id });
export type DeleteTaskInput = z.input<typeof deleteTaskSchema>;
