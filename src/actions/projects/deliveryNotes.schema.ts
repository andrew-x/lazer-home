/**
 * Zod schemas for project delivery notes. A pure, client-importable module (no
 * `db`/drizzle): the note form imports `deliveryNoteContentSchema` as its
 * resolver, so a drizzle-derived schema here would pull the table and
 * `drizzle-orm` into the client bundle (ADR 0035).
 *
 * One `deliveryNoteFields` object spread into create and update, as
 * `selfEvaluations.schema.ts` and `reviewNotes.schema.ts` do — the two differ only
 * in which id they carry, and the content rules must not drift between them.
 */
import { z } from "zod";
import {
  DELIVERY_NOTE_BODY_MAX,
  DELIVERY_NOTE_TITLE_MAX,
} from "@/lib/projects/delivery-note";
import {
  PROJECT_HEALTH_MAX,
  PROJECT_HEALTH_MIN,
} from "@/lib/projects/project-health";
import { dateString } from "@/lib/schemas/date-schema";
import { id } from "@/lib/schemas/id-schema";
import { optionalText, requiredText } from "@/lib/schemas/text-schema";

/** The editable content of a delivery note, identical on create and update. */
export const deliveryNoteFields = {
  /** The date the note is about — not the date it was typed. */
  noteDate: dateString,
  // `optionalText`, not `optionalTrimmedText`: it accepts null/undefined on input
  // too, so an already-validated (already-null) title can be handed straight back
  // to the action without the round-trip failing re-validation — the same reason
  // `reviewNoteFields.title` uses it.
  title: optionalText(
    DELIVERY_NOTE_TITLE_MAX,
    `Keep the title under ${DELIVERY_NOTE_TITLE_MAX} characters.`,
  ),
  body: requiredText(DELIVERY_NOTE_BODY_MAX),
  // Required: the rating is the reason a note also feeds the projects list, and
  // the star input has no "clear" affordance to produce a null with. The bounds
  // come from the scale module, which also drives the DB check constraint, so the
  // two ends can't drift. All three messages are the same sentence — from the
  // writer's side, "no stars" and "somehow out of range" are one mistake.
  projectHealth: z
    .number({ message: "Rate the project's health." })
    .int("Rate the project's health.")
    .min(PROJECT_HEALTH_MIN, "Rate the project's health.")
    .max(PROJECT_HEALTH_MAX, "Rate the project's health."),
};

/** The form's resolver — the note's content, with no ids attached. */
export const deliveryNoteContentSchema = z.object(deliveryNoteFields);

// Both sides of the transform are exported because the schema maps a blank title
// to null: the form's values are the *input* shape, the action receives the output.
export type DeliveryNoteContentInput = z.input<
  typeof deliveryNoteContentSchema
>;
export type DeliveryNoteContentValues = z.output<
  typeof deliveryNoteContentSchema
>;

// Deliberately absent from every schema below: `authorStaffId`, which is resolved
// from the session and never accepted from the client, and `projectId` on update —
// a note belongs to the engagement it was written about and can't be moved.
export const createProjectDeliveryNoteSchema = z.object({
  projectId: id,
  ...deliveryNoteFields,
});
export type CreateProjectDeliveryNoteInput = z.input<
  typeof createProjectDeliveryNoteSchema
>;

export const updateProjectDeliveryNoteSchema = z.object({
  noteId: id,
  ...deliveryNoteFields,
});
export type UpdateProjectDeliveryNoteInput = z.input<
  typeof updateProjectDeliveryNoteSchema
>;

export const deleteProjectDeliveryNoteSchema = z.object({ noteId: id });
export type DeleteProjectDeliveryNoteInput = z.input<
  typeof deleteProjectDeliveryNoteSchema
>;
