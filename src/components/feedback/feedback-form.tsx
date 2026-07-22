"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { Controller, type FieldPath, useForm } from "react-hook-form";
import { createFeedback } from "@/actions/feedback/createFeedback";
import {
  type CreateFeedbackInput,
  createFeedbackSchema,
} from "@/actions/feedback/createFeedback.schema";
import { searchStaffForFeedback } from "@/actions/feedback/searchStaffForFeedback";
import { applyServerIssues } from "@/components/form/apply-server-issues";
import { EntityCombobox } from "@/components/form/entity-combobox";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import { FormField } from "@/components/form/form-field";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/core/utils";
import {
  FEEDBACK_RATING_DESCRIPTIONS,
  FEEDBACK_RATING_LABELS,
  FEEDBACK_RATINGS,
  type FeedbackRating,
} from "@/lib/performance/feedback-rating";

type FeedbackFormValues = {
  recipient: EntityOption | null;
  rating: FeedbackRating | "";
  context: string;
  keepDoing: string;
  stopDoing: string;
  startDoing: string;
  other: string;
  messageToRecipient: string;
};

const DEFAULT_VALUES: FeedbackFormValues = {
  recipient: null,
  rating: "",
  context: "",
  keepDoing: "",
  stopDoing: "",
  startDoing: "",
  other: "",
  messageToRecipient: "",
};

// Maps a server-schema issue path to its form field, typed by the schema input
// so a new field can't silently drop its errors. `toStaffId` surfaces on the
// recipient picker; the refine ("at least one of…") reports on `keepDoing`.
const FIELD_FOR_ISSUE: Record<
  keyof CreateFeedbackInput,
  FieldPath<FeedbackFormValues>
> = {
  toStaffId: "recipient",
  rating: "rating",
  context: "context",
  keepDoing: "keepDoing",
  stopDoing: "stopDoing",
  startDoing: "startDoing",
  other: "other",
  messageToRecipient: "messageToRecipient",
};

const FREE_TEXT_FIELDS = [
  {
    name: "keepDoing",
    label: "Keep doing",
    placeholder: "What should they keep doing?",
  },
  {
    name: "stopDoing",
    label: "Stop doing",
    placeholder: "What should they stop doing?",
  },
  {
    name: "startDoing",
    label: "Start doing",
    placeholder: "What should they start doing?",
  },
  {
    name: "other",
    label: "Other (optional)",
    placeholder: "Anything else worth noting?",
  },
] as const;

/** The peer-feedback form, rendered on its own page (`/feedback/new`). */
export function FeedbackForm() {
  const router = useRouter();
  const {
    register,
    control,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<FeedbackFormValues>({ defaultValues: DEFAULT_VALUES });

  const { execute, result, isPending } = useAction(createFeedback, {
    onSuccess: () => {
      router.push("/feedback");
      router.refresh();
    },
  });

  const onSubmit = (values: FeedbackFormValues) => {
    clearErrors();
    const payload = {
      toStaffId: values.recipient?.id ?? "",
      rating: values.rating,
      context: values.context,
      keepDoing: values.keepDoing,
      stopDoing: values.stopDoing,
      startDoing: values.startDoing,
      other: values.other,
      messageToRecipient: values.messageToRecipient,
    };

    const parsed = createFeedbackSchema.safeParse(payload);
    if (!parsed.success) {
      applyServerIssues(setError, parsed.error, FIELD_FOR_ISSUE);
      return;
    }

    execute(parsed.data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Controller
        control={control}
        name="recipient"
        render={({ field, fieldState }) => (
          <FormField
            label="Who is this feedback for?"
            error={fieldState.error?.message}
          >
            <EntityCombobox
              value={field.value}
              onChange={(next) => {
                field.onChange(next);
                if (next) clearErrors("recipient");
              }}
              searchAction={searchStaffForFeedback}
              placeholder="Search active staff…"
              invalid={Boolean(fieldState.error)}
            />
          </FormField>
        )}
      />

      <Controller
        control={control}
        name="rating"
        render={({ field, fieldState }) => (
          <FormField label="Rating" error={fieldState.error?.message}>
            <RadioGroup
              value={field.value || undefined}
              onValueChange={(next) => {
                field.onChange(next);
                clearErrors("rating");
              }}
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
                        {FEEDBACK_RATING_DESCRIPTIONS[rating]}
                      </span>
                    </span>
                  </label>
                );
              })}
            </RadioGroup>
          </FormField>
        )}
      />

      <FormField
        label="Context"
        htmlFor="feedback-context"
        error={errors.context?.message}
      >
        <Textarea
          id="feedback-context"
          placeholder="How and when did you work with this person?"
          aria-invalid={Boolean(errors.context)}
          {...register("context")}
        />
      </FormField>

      {FREE_TEXT_FIELDS.map((f) => (
        <FormField
          key={f.name}
          label={f.label}
          htmlFor={`feedback-${f.name}`}
          error={errors[f.name]?.message}
        >
          <Textarea
            id={`feedback-${f.name}`}
            placeholder={f.placeholder}
            aria-invalid={Boolean(errors[f.name])}
            {...register(f.name)}
          />
        </FormField>
      ))}

      <FormField
        label="Message to recipient (optional)"
        htmlFor="feedback-message"
        error={errors.messageToRecipient?.message}
        className="rounded border bg-muted/50 p-3"
      >
        <p className="-mt-1 mb-1.5 text-xs text-muted-foreground">
          This is the <span className="font-medium text-foreground">only</span>{" "}
          part of your feedback the recipient can see — along with your name.
        </p>
        <Textarea
          id="feedback-message"
          placeholder="A note you'd like them to read…"
          aria-invalid={Boolean(errors.messageToRecipient)}
          {...register("messageToRecipient")}
        />
      </FormField>

      <div className="flex flex-col gap-3">
        {result.serverError ? (
          <p className="text-sm text-destructive">{result.serverError}</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            render={<Link href="/feedback" />}
          >
            Cancel
          </Button>
          <Button type="submit" loading={isPending}>
            Submit feedback
          </Button>
        </div>
      </div>
    </form>
  );
}
