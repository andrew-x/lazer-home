/**
 * Delivery notes — the pure, client-importable core (no `db`/drizzle).
 *
 * A delivery note is a dated write-up of how an engagement is actually going,
 * carrying the author's own 1–10 health rating (`@/lib/projects/project-health`).
 * Unlike a performance review note there is **no lifecycle and no draft**: reads
 * are open like every other project read, and create/edit/delete alike are the
 * static `projects.edit` capability. The team that runs an engagement owns its
 * record, so anyone who could write a note can correct it — see ADR 0059.
 *
 * Owns the field limits so the zod schema and the form's inputs share one source.
 * The scale lives in its own module because `project-flags.ts` imports it to
 * evaluate the low-health tag and has no business knowing a note's text limits.
 */

/** Max lengths, shared by the zod schema and the form's inputs. */
export const DELIVERY_NOTE_TITLE_MAX = 200;
export const DELIVERY_NOTE_BODY_MAX = 20_000;

/** What a delivery note is and who can see it, said once. */
export const DELIVERY_NOTE_HINT =
  "A dated read on how the engagement is going. Visible to everyone who can see the project.";

/** Shown in place of a title when a note has none — the note's date stands in. */
export const DELIVERY_NOTE_TITLE_PLACEHOLDER =
  "Optional — the date is used when blank";
