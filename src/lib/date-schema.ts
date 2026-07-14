import { z } from "zod";

/**
 * A calendar date as a timezone-agnostic "YYYY-MM-DD" string (the DatePicker's
 * output and the DB's `date()` wall-clock format). The shared primitive so every
 * schema validates the same shape with the same message — the date counterpart to
 * `id`/`idList`. See `.claude/rules/database.md` on dates being wall-clock values.
 */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const dateString = z.string().regex(ISO_DATE, "Pick a valid date.");
