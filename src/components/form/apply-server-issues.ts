import type { FieldPath, FieldValues, UseFormSetError } from "react-hook-form";
import type { z } from "zod";

/**
 * A nested field-array target for {@link applyServerIssues}: the array field's
 * name plus a map from the schema's row sub-field name to the form's row
 * sub-field name. Lets a `roles[2].staffId` issue land on the react-hook-form
 * path `roles.2.staff`.
 */
export type NestedIssueTarget<TFieldValues extends FieldValues> = {
  readonly array: FieldPath<TFieldValues>;
  readonly fields: Readonly<Record<string, string>>;
};

/** Where a schema issue lands: a flat form field, or a nested field-array row. */
export type IssueTarget<TFieldValues extends FieldValues> =
  | FieldPath<TFieldValues>
  | NestedIssueTarget<TFieldValues>;

/**
 * Routes the issues from a failed client-side `safeParse` onto a
 * react-hook-form via `setError`, using `fieldMap` to translate each Zod issue
 * path to its form field. Replaces the hand-rolled "iterate issues → look up
 * `path[0]` → `setError`" loop duplicated across the create forms.
 *
 * `fieldMap` is keyed by the schema's top-level field name. Each value is
 * either a form field path (flat case) or a {@link NestedIssueTarget} that
 * reconstructs a dotted `array.index.subField` path for field-array rows.
 * Callers should type their map as `Record<keyof <Input>, ...>` so tsc keeps
 * forcing an entry per schema field — a new field can't silently drop errors.
 */
export function applyServerIssues<TFieldValues extends FieldValues>(
  setError: UseFormSetError<TFieldValues>,
  error: z.ZodError,
  fieldMap: Partial<Record<string, IssueTarget<TFieldValues>>>,
): void {
  for (const issue of error.issues) {
    const [head, index, sub] = issue.path;
    if (typeof head !== "string") continue;

    const target = fieldMap[head];
    if (!target) continue;

    // Flat field: map straight to its form field.
    if (typeof target === "string") {
      setError(target, { message: issue.message });
      continue;
    }

    // Nested field-array row: expect an [array, index, subField] path.
    if (typeof index !== "number" || typeof sub !== "string") continue;
    const subField = target.fields[sub];
    if (!subField) continue;
    setError(
      `${target.array}.${index}.${subField}` as FieldPath<TFieldValues>,
      {
        message: issue.message,
      },
    );
  }
}
