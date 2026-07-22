import { z } from "zod";

/**
 * Optional free-text field validator. Blank/whitespace → null; otherwise
 * trimmed. Accepts null/undefined on input too, so re-parsing the transformed
 * value (client → server round-trip) is stable. The `max` length is enforced on
 * the raw input, with an optional custom over-limit `message`.
 *
 * Shared by every optional-text form field (contact phone/role, opportunity
 * next steps) so the trim / empty→null / max behaviour stays consistent in one
 * place — the text counterpart to `optionalUrl` in `url-schema.ts`.
 */
export const optionalText = (max: number, message?: string) =>
  z
    .string()
    .max(max, message)
    .nullish()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    });

/**
 * Required free-text field that trims first, enforces `max` on the trimmed
 * value (with an optional custom message), and maps a fully-blank value to null.
 * Unlike `optionalText`, the input stays a required string — use where the form
 * always sends the field (e.g. an edit form's cleared textarea sends "").
 */
export const optionalTrimmedText = (max: number, message?: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => (value === "" ? null : value));

/**
 * Mandatory free-text field: trimmed, non-empty, and capped at `max`. Blank or
 * whitespace-only input is rejected. Use where a value is genuinely required and
 * must survive as a non-null string (e.g. a note or next-step entry body).
 */
export const requiredText = (max: number, message?: string) =>
  z
    .string()
    .trim()
    .min(1, message ?? "Required")
    .max(max, message);
