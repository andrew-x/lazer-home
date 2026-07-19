"use client";

import { IconArrowLeft, IconArrowRight } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import type { WaysOfWorking } from "@/actions/responses/getWaysOfWorking";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  type MatrixSection,
  type MultiselectField,
  type SingleSelectField,
  type TextField,
  WAYS_OF_WORKING_QUESTION_IDS,
  WOW_LIST_QUESTION_IDS,
  WOW_SECTIONS,
  type WowQuestionId,
  type WowSection,
} from "@/lib/ways-of-working";
import { aggregateSaveState, SaveIndicator } from "./response-save-indicator";
import {
  isEmpty,
  type ResponseValue,
  useResponseAutosave,
} from "./use-response-autosave";

/** The question ids a section owns — used for progress and the section's
 * aggregate save indicator. */
function sectionQuestionIds(section: WowSection): WowQuestionId[] {
  if (section.kind === "matrix") {
    return [
      section.usage.critical,
      section.usage.common,
      section.usage.avoid,
      section.savings.major,
      section.savings.minor,
      section.savings.no,
    ];
  }
  return section.fields.map((field) => field.questionId);
}

/**
 * The guided Ways of Working editor: one section per step (Editors & Learning,
 * the AI usage/tools matrices, Problems, Confidence & Output, the engineering-
 * workflow deep dive, and a catch-all). Every field autosaves independently via
 * the shared `useResponseAutosave` engine — no big Submit; "Done" returns to the
 * profile. The survey is long, so a step rail lets you fill sections in any
 * order across sittings.
 */
export function WaysOfWorkingGuide({
  staffId,
  responses,
}: {
  staffId: string;
  responses: WaysOfWorking;
}) {
  const router = useRouter();
  const total = WOW_SECTIONS.length;
  const [step, setStep] = useState(0);

  const initial = useMemo<Record<string, ResponseValue>>(() => {
    const values: Record<string, ResponseValue> = {};
    for (const id of WAYS_OF_WORKING_QUESTION_IDS) {
      const answer = responses.answers[id];
      values[id] = WOW_LIST_QUESTION_IDS.has(id)
        ? (answer.listResponse ?? [])
        : (answer.textResponse ?? "");
    }
    return values;
  }, [responses]);

  const { answers, saved, fieldState, setAnswer, flushField, flushAll } =
    useResponseAutosave(staffId, initial);

  const section = WOW_SECTIONS[step];
  const isLast = step === total - 1;

  const goTo = useCallback(
    (target: number) => {
      if (target < 0 || target >= total || target === step) return;
      void flushAll();
      setStep(target);
    },
    [flushAll, step],
  );

  async function finish() {
    const ok = await flushAll();
    if (!ok) return;
    router.push(`/staff/${staffId}`);
  }

  const answeredPerSection = WOW_SECTIONS.map((s) =>
    sectionQuestionIds(s).some((id) => !isEmpty(saved[id] ?? "")),
  );
  const sectionState = aggregateSaveState(
    sectionQuestionIds(section).map((id) => fieldState[id] ?? "idle"),
  );

  return (
    <div className="flex flex-col gap-6">
      <StepRail
        step={step}
        titles={WOW_SECTIONS.map((s) => s.title)}
        answered={answeredPerSection}
        onJump={goTo}
      />

      <div className="flex min-h-[24rem] flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <h2 className="font-heading text-2xl font-semibold tracking-tight text-balance">
            {section.title}
          </h2>
          {section.subtitle ? (
            <p className="text-sm text-muted-foreground">{section.subtitle}</p>
          ) : null}
        </div>

        <SectionBody
          section={section}
          listValue={(id) => (answers[id] as string[] | undefined) ?? []}
          textValue={(id) => (answers[id] as string | undefined) ?? ""}
          setAnswer={setAnswer}
          flushField={flushField}
        />

        <SaveIndicator state={sectionState} />
      </div>

      <div className="flex items-center justify-between gap-2 border-t pt-4">
        <Button
          type="button"
          variant="ghost"
          onClick={() => goTo(step - 1)}
          disabled={step === 0}
        >
          <IconArrowLeft />
          Back
        </Button>
        {isLast ? (
          <Button type="button" onClick={finish}>
            Done
          </Button>
        ) : (
          <Button type="button" onClick={() => goTo(step + 1)}>
            Next
            <IconArrowRight />
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section bodies
// ---------------------------------------------------------------------------

type FieldProps = {
  listValue: (id: WowQuestionId) => string[];
  textValue: (id: WowQuestionId) => string;
  setAnswer: (
    id: string,
    value: ResponseValue,
    options?: { immediate?: boolean },
  ) => void;
  flushField: (id: string) => void;
};

function SectionBody({
  section,
  ...field
}: { section: WowSection } & FieldProps) {
  switch (section.kind) {
    case "multiselect":
      return (
        <div className="flex flex-col gap-6">
          {section.fields.map((f) => (
            <MultiselectBlock key={f.questionId} field={f} {...field} />
          ))}
        </div>
      );
    case "text":
      return (
        <div className="flex flex-col gap-6">
          {section.intro ? (
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
              <p>{section.intro.sequence}</p>
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {section.intro.guidance.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {section.fields.map((f) => (
            <TextBlock key={f.questionId} field={f} {...field} />
          ))}
        </div>
      );
    case "single-select":
      return (
        <div className="flex flex-col gap-5">
          {section.fields.map((f) => (
            <SingleSelectBlock key={f.questionId} field={f} {...field} />
          ))}
        </div>
      );
    case "matrix":
      return <Matrix section={section} {...field} />;
  }
}

/** A field's label + optional subtitle. */
function FieldHeader({
  label,
  subtitle,
}: {
  label: string;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {subtitle ? (
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      ) : null}
    </div>
  );
}

function MultiselectBlock({
  field,
  listValue,
  setAnswer,
}: { field: MultiselectField } & FieldProps) {
  const selected = listValue(field.questionId);
  const toggle = (option: string) =>
    setAnswer(
      field.questionId,
      selected.includes(option)
        ? selected.filter((item) => item !== option)
        : [...selected, option],
      { immediate: true },
    );

  return (
    <div className="flex flex-col gap-2.5">
      <FieldHeader label={field.label} subtitle={field.subtitle} />
      <div className="flex flex-wrap gap-1.5">
        {field.options.map((option) => {
          const isSelected = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={isSelected}
              onClick={() => toggle(option)}
              className={cn(
                "rounded-4xl border px-3 py-1 text-left text-sm transition-colors",
                isSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:border-foreground/30 hover:bg-muted hover:text-foreground",
              )}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TextBlock({
  field,
  textValue,
  setAnswer,
  flushField,
}: { field: TextField } & FieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <FieldHeader label={field.label} subtitle={field.subtitle} />
      <Textarea
        value={textValue(field.questionId)}
        onChange={(event) => setAnswer(field.questionId, event.target.value)}
        onBlur={() => flushField(field.questionId)}
        placeholder={
          field.placeholder ?? "Write as much or as little as you like."
        }
        className="min-h-32"
      />
    </div>
  );
}

function SingleSelectBlock({
  field,
  textValue,
  setAnswer,
}: { field: SingleSelectField } & FieldProps) {
  const value = textValue(field.questionId);
  return (
    <div className="flex flex-col gap-2">
      <FieldHeader label={field.label} subtitle={field.subtitle} />
      <Select
        value={value || null}
        onValueChange={(next: string | null) =>
          setAnswer(field.questionId, next ?? "", { immediate: true })
        }
      >
        <SelectTrigger className="w-full">
          <SelectValue>
            {(v: string | null) =>
              v ? v : <span className="text-muted-foreground">Choose one…</span>
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {field.options.map((option) => (
            <SelectItem key={option} value={option}>
              {/* Override the primitive's nowrap so long confidence options
                  wrap instead of clipping. */}
              <span className="whitespace-normal">{option}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The usage / savings matrix
// ---------------------------------------------------------------------------

type UsageTier = "critical" | "common" | "avoid";
type SavingsTier = "major" | "minor" | "no";

const USAGE_OPTIONS: { value: UsageTier; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "common", label: "Common" },
  { value: "avoid", label: "Avoid" },
];

const SAVINGS_OPTIONS: { value: SavingsTier; label: string }[] = [
  { value: "major", label: "Major" },
  { value: "minor", label: "Minor" },
  { value: "no", label: "None" },
];

function Matrix({
  section,
  listValue,
  setAnswer,
}: { section: MatrixSection } & FieldProps) {
  const usageIds = section.usage;
  const savingsIds = section.savings;

  const usageOf = (item: string): UsageTier | null => {
    if (listValue(usageIds.critical).includes(item)) return "critical";
    if (listValue(usageIds.common).includes(item)) return "common";
    if (listValue(usageIds.avoid).includes(item)) return "avoid";
    return null;
  };
  const savingsOf = (item: string): SavingsTier | null => {
    if (listValue(savingsIds.major).includes(item)) return "major";
    if (listValue(savingsIds.minor).includes(item)) return "minor";
    if (listValue(savingsIds.no).includes(item)) return "no";
    return null;
  };

  /** Put `item` into exactly the bucket for `tier` (or none) across a group of
   * three list-backed ids, editing only the lists that actually change. */
  const assign = (
    ids: Record<string, WowQuestionId>,
    item: string,
    tier: string | null,
  ) => {
    for (const [key, questionId] of Object.entries(ids)) {
      const current = listValue(questionId);
      const has = current.includes(item);
      const should = key === tier;
      if (has === should) continue;
      setAnswer(
        questionId,
        should ? [...current, item] : current.filter((x) => x !== item),
        { immediate: true },
      );
    }
  };

  const setUsage = (item: string, tier: UsageTier | null) => {
    assign(usageIds, item, tier);
    // Savings only makes sense for something you use — clear it when usage goes.
    if (tier === null) assign(savingsIds, item, null);
  };

  return (
    <div className="flex flex-col gap-6">
      {section.groups.map((group) => (
        <div key={group.name} className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {group.name}
            </h3>
            <div className="hidden gap-6 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:flex">
              <span className="w-[168px] text-center">Usage</span>
              <span className="w-[168px] text-center">Savings</span>
            </div>
          </div>
          <div className="flex flex-col divide-y rounded-lg border">
            {group.items.map((item) => {
              const usage = usageOf(item);
              return (
                <div
                  key={item}
                  className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <span className="text-sm">{item}</span>
                  <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                    <Segmented
                      ariaLabel={`How you use ${item}`}
                      options={USAGE_OPTIONS}
                      value={usage}
                      onChange={(tier) => setUsage(item, tier)}
                    />
                    <Segmented
                      ariaLabel={`Time saved by ${item}`}
                      options={SAVINGS_OPTIONS}
                      value={savingsOf(item)}
                      disabled={usage === null}
                      onChange={(tier) => assign(savingsIds, item, tier)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A small segmented control; clicking the active segment clears it (→ null). */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T | null) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <fieldset
      aria-label={ariaLabel}
      className={cn(
        "m-0 inline-flex min-w-0 w-[168px] rounded-lg border p-0.5",
        disabled && "opacity-50",
      )}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(active ? null : option.value)}
            className={cn(
              "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground enabled:hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Step rail (section-oriented)
// ---------------------------------------------------------------------------

function StepRail({
  step,
  titles,
  answered,
  onJump,
}: {
  step: number;
  titles: string[];
  answered: boolean[];
  onJump: (target: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">
          {titles[step]} · {step + 1} of {titles.length}
        </span>
        <span className="text-xs text-muted-foreground">
          {answered.filter(Boolean).length} of {titles.length} started
        </span>
      </div>
      <div className="flex gap-1.5">
        {titles.map((title, index) => (
          <button
            key={title}
            type="button"
            onClick={() => onJump(index)}
            aria-label={`Go to section ${index + 1}: ${title}`}
            aria-current={index === step ? "step" : undefined}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              index === step
                ? "bg-primary"
                : answered[index]
                  ? "bg-foreground/40 hover:bg-foreground/60"
                  : "bg-muted hover:bg-muted-foreground/30",
            )}
          />
        ))}
      </div>
    </div>
  );
}
