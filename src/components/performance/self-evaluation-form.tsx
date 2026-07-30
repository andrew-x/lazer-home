"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { useId } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { createSelfEvaluation } from "@/actions/performance/createSelfEvaluation";
import type { SelfEvaluationRow } from "@/actions/performance/getStaffSelfEvaluations";
import {
  type SelfEvaluationContentInput,
  type SelfEvaluationContentValues,
  selfEvaluationContentSchema,
} from "@/actions/performance/selfEvaluations.schema";
import { updateSelfEvaluation } from "@/actions/performance/updateSelfEvaluation";
import { FormField } from "@/components/form/form-field";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/core/utils";
import {
  FEEDBACK_RATING_LABELS,
  FEEDBACK_RATINGS,
} from "@/lib/performance/feedback-rating";
import {
  SELF_EVALUATION_QUESTION_IDS,
  SELF_EVALUATION_QUESTIONS,
  SELF_EVALUATION_SAVE_WARNING,
  SELF_RATING_DESCRIPTIONS,
  SELF_RATING_PROMPT,
  type SelfEvaluationQuestionId,
} from "@/lib/performance/self-evaluation";

/**
 * Every question starts as "" so the form always sends each field — the schema's
 * `optionalText` then maps blank → null and the write drops it from the record.
 * An edit fills in whatever the record holds for each *current* question;
 * a record answering an older set can't be edited at all (see `updateSelfEvaluation`),
 * so there is no case where a stored answer has nowhere to go.
 */
function answerDefaults(
  evaluation?: SelfEvaluationRow,
): Record<SelfEvaluationQuestionId, string> {
  const stored = new Map(
    evaluation?.answers.map((entry) => [entry.questionId, entry.answer]) ?? [],
  );
  return Object.fromEntries(
    SELF_EVALUATION_QUESTION_IDS.map((questionId) => [
      questionId,
      stored.get(questionId) ?? "",
    ]),
  ) as Record<SelfEvaluationQuestionId, string>;
}

/**
 * The self-evaluation composer / editor: the seven reflection prompts and the overall
 * self-rating, saved in one explicit submit (no autosave — this is a document a person
 * finishes, not a field they nudge).
 *
 * Loose binding (`useForm` + `useAction`) rather than `useHookFormAction`, because the
 * form shape deliberately omits the id the update action needs. Both actions' hooks
 * are instantiated every render (stable hook order) and the mode picks between them,
 * the same way `ReviewNoteForm` does. Create takes nothing extra, edit takes the
 * record — a union rather than two optional props, so "neither" can't be constructed.
 *
 * The questions come from the current set here (this is one of only two places that
 * may consult it); the stored `section`/`prompt` snapshot is derived server-side.
 */
export function SelfEvaluationForm(
  props: { onSaved: () => void; onCancel: () => void } & (
    | { mode: "create"; evaluation?: never }
    | { evaluation: SelfEvaluationRow; mode?: never }
  ),
) {
  const { evaluation, onSaved, onCancel } = props;
  const fieldId = useId();

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
    // The third generic is the *transformed* shape `handleSubmit` receives: the schema
    // trims each answer and maps a blank one to null, so the handler already holds
    // exactly what the actions take.
  } = useForm<SelfEvaluationContentInput, unknown, SelfEvaluationContentValues>(
    {
      resolver: zodResolver(selfEvaluationContentSchema),
      defaultValues: {
        // Left unset when composing, so an unanswered rating fails validation with
        // "Pick a rating" rather than defaulting someone into a self-assessment.
        selfRating: evaluation?.selfRating,
        answers: answerDefaults(evaluation),
      },
    },
  );

  const create = useAction(createSelfEvaluation, {
    onSuccess: () => {
      toast.success("Self-evaluation saved.");
      onSaved();
    },
  });
  const update = useAction(updateSelfEvaluation, {
    onSuccess: () => {
      toast.success("Self-evaluation updated.");
      onSaved();
    },
  });

  const active = evaluation ? update : create;

  const onSubmit = handleSubmit((values) => {
    if (props.evaluation) {
      update.execute({ evaluationId: props.evaluation.id, ...values });
    } else {
      create.execute(values);
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {SELF_EVALUATION_QUESTION_IDS.map((questionId) => {
        const question = SELF_EVALUATION_QUESTIONS[questionId];
        return (
          <section key={questionId} className="flex flex-col gap-2">
            <h4 className="font-heading text-base font-medium leading-snug">
              {question.section}
            </h4>
            <FormField
              // Wrapped so a prompt long enough to run onto a second line isn't
              // squeezed by `Label`'s `leading-none`.
              label={<span className="leading-snug">{question.prompt}</span>}
              htmlFor={`${fieldId}-${questionId}`}
              error={errors.answers?.[questionId]?.message}
            >
              {question.guidance.length > 0 ? (
                <ul className="list-disc pl-5 text-xs text-muted-foreground">
                  {question.guidance.map((hint) => (
                    <li key={hint}>{hint}</li>
                  ))}
                </ul>
              ) : null}
              <Textarea
                id={`${fieldId}-${questionId}`}
                rows={5}
                aria-invalid={Boolean(errors.answers?.[questionId])}
                {...register(`answers.${questionId}`)}
              />
            </FormField>
          </section>
        );
      })}

      <Controller
        control={control}
        name="selfRating"
        render={({ field, fieldState }) => (
          <FormField
            label={<span className="leading-snug">{SELF_RATING_PROMPT}</span>}
            error={fieldState.error?.message}
          >
            <RadioGroup
              value={field.value ?? undefined}
              onValueChange={field.onChange}
              aria-invalid={Boolean(fieldState.error)}
            >
              {FEEDBACK_RATINGS.map((rating) => {
                const active = field.value === rating;
                return (
                  // biome-ignore lint/a11y/noLabelWithoutControl: RadioGroupItem (Base UI Radio.Root) renders its input inside this label.
                  <label
                    key={rating}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded border p-2.5 transition-colors",
                      active
                        ? "border-primary bg-muted/50"
                        : "hover:bg-muted/40",
                    )}
                  >
                    <RadioGroupItem value={rating} className="mt-0.5" />
                    <span className="flex flex-col">
                      <span className="text-sm font-medium">
                        {FEEDBACK_RATING_LABELS[rating]}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {SELF_RATING_DESCRIPTIONS[rating]}
                      </span>
                    </span>
                  </label>
                );
              })}
            </RadioGroup>
          </FormField>
        )}
      />

      {active.result.serverError ? (
        <p className="text-sm text-destructive">{active.result.serverError}</p>
      ) : null}

      {/* Sticky, because the form is long enough that the buttons would otherwise be
          a scroll away from wherever you finished typing. */}
      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t bg-card px-4 py-3 sm:-mx-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {SELF_EVALUATION_SAVE_WARNING}
        </p>
        <div className="flex shrink-0 items-center justify-end gap-2">
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
      </div>
    </form>
  );
}
