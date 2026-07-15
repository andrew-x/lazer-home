"use client";

import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconLoader2,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ManualOfMeEntry } from "@/actions/responses/getManualOfMe";
import { upsertResponse } from "@/actions/responses/upsertResponse";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * The guided Manual of Me editor: one question at a time, so filling it out
 * feels like a calm conversation rather than a wall of textareas. Each answer
 * autosaves — on blur, after a short pause in typing, and whenever you move
 * between questions — so nobody has to finish in one sitting (a few of these
 * questions explicitly invite coming back later). There is no big Submit: the
 * "Done" button just returns to the profile.
 */
export function ManualOfMeGuide({
  staffId,
  entries,
}: {
  staffId: string;
  entries: ManualOfMeEntry[];
}) {
  const router = useRouter();
  const total = entries.length;

  const [step, setStep] = useState(0);
  // Current textarea text per question.
  const [answers, setAnswers] = useState<string[]>(() =>
    entries.map((entry) => entry.textResponse ?? ""),
  );
  // Last value we've persisted per question (trimmed), so we know what's saved
  // and which questions are answered. Drives the step rail's check marks.
  const [saved, setSaved] = useState<string[]>(() =>
    entries.map((entry) => entry.textResponse ?? ""),
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // Refs mirror state so timers, async callbacks, and the unmount cleanup read
  // current values without going stale in a closure.
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const stepRef = useRef(step);
  stepRef.current = step;
  const savingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { executeAsync } = useAction(upsertResponse);

  /**
   * Persist question `i` if its value changed since the last save. Serialized
   * via `savingRef`: only one save runs at a time, and on completion we re-check
   * for fresh edits (to `i` or, if `i` is no longer current, to the current
   * step) and flush those too. The "saved" indicator only lights up when the
   * field still matches what we sent — so typing-through-a-save never shows a
   * stale ✓.
   */
  const flush = useCallback(
    async (i: number) => {
      if (savingRef.current) return;
      const value = answersRef.current[i];
      const trimmed = value.trim();
      if (trimmed === savedRef.current[i]) return;

      savingRef.current = true;
      if (i === stepRef.current) setSaveState("saving");

      const res = await executeAsync({
        staffId,
        questionId: entries[i].id,
        textResponse: value,
      }).catch(() => null);

      savingRef.current = false;

      if (res?.data?.ok) {
        setSaved((current) => {
          const next = [...current];
          next[i] = trimmed;
          return next;
        });
        savedRef.current = savedRef.current.map((v, idx) =>
          idx === i ? trimmed : v,
        );
        const stillCurrent = i === stepRef.current;
        const unchanged = answersRef.current[i].trim() === trimmed;
        if (stillCurrent) setSaveState(unchanged ? "saved" : "saving");
        // If edits landed mid-save (here or on the now-current step), save again.
        const dirtyStep =
          answersRef.current[stepRef.current].trim() !==
          savedRef.current[stepRef.current]
            ? stepRef.current
            : !unchanged
              ? i
              : null;
        if (dirtyStep !== null) void flush(dirtyStep);
      } else if (i === stepRef.current) {
        setSaveState("error");
      }
    },
    [entries, executeAsync, staffId],
  );

  // Debounced autosave while typing on the current step.
  useEffect(() => {
    if (answers[step].trim() === saved[step]) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void flush(step), 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [answers, saved, step, flush]);

  // Best-effort save if the component unmounts mid-edit (e.g. browser back).
  useEffect(() => {
    return () => {
      void flush(stepRef.current);
    };
  }, [flush]);

  const goTo = useCallback(
    (target: number) => {
      if (target < 0 || target >= total || target === stepRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      void flush(stepRef.current);
      setStep(target);
      // Reset the transient indicator for the question we're arriving at.
      setSaveState("idle");
    },
    [flush, total],
  );

  function updateAnswer(value: string) {
    setAnswers((current) => {
      const next = [...current];
      next[step] = value;
      return next;
    });
    if (saveState !== "idle") setSaveState("idle");
  }

  function finish() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void flush(stepRef.current);
    router.push(`/staff/${staffId}`);
  }

  const current = entries[step];
  const isLast = step === total - 1;

  return (
    <div className="flex flex-col gap-6">
      <StepRail
        total={total}
        step={step}
        saved={saved}
        onJump={goTo}
        titles={entries.map((entry) => entry.title)}
      />

      <div className="flex min-h-[22rem] flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 className="font-heading text-2xl font-semibold tracking-tight text-balance">
            {current.title}
          </h2>
          <p className="text-sm text-muted-foreground">{current.subtitle}</p>
        </div>

        <Textarea
          // Remount per question so focus and the auto-grow height reset cleanly.
          key={current.id}
          value={answers[step]}
          onChange={(event) => updateAnswer(event.target.value)}
          onBlur={() => void flush(step)}
          placeholder="Take your time — write as much or as little as feels right."
          className="min-h-48 flex-1"
          autoFocus
        />

        <SaveIndicator state={saveState} />
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

/**
 * The step rail: "Question n of total" plus a row of clickable segments — one
 * per question — that double as progress and a jump nav. Flat by design (no
 * shadow); the current step reads in the accent, answered ones in foreground,
 * the rest muted.
 */
function StepRail({
  total,
  step,
  saved,
  onJump,
  titles,
}: {
  total: number;
  step: number;
  saved: string[];
  onJump: (target: number) => void;
  titles: string[];
}) {
  const answeredCount = saved.filter((value) => value !== "").length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">
          Question {step + 1} of {total}
        </span>
        <span className="text-xs text-muted-foreground">
          {answeredCount} answered
        </span>
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: total }, (_, index) => {
          const isCurrent = index === step;
          const isAnswered = saved[index] !== "";
          return (
            <button
              key={titles[index]}
              type="button"
              onClick={() => onJump(index)}
              aria-label={`Go to question ${index + 1}: ${titles[index]}`}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                isCurrent
                  ? "bg-primary"
                  : isAnswered
                    ? "bg-foreground/40 hover:bg-foreground/60"
                    : "bg-muted hover:bg-muted-foreground/30",
              )}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Subtle inline autosave status for the current question (never a toast). */
function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") {
    return (
      <p className="text-xs text-muted-foreground">
        Your answers save automatically.
      </p>
    );
  }
  if (state === "saving") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <IconLoader2 className="size-3.5 animate-spin" />
        Saving…
      </p>
    );
  }
  if (state === "error") {
    return (
      <p className="text-xs text-destructive">
        Couldn't save — check your connection; we'll retry as you edit.
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <IconCheck className="size-3.5 text-primary" />
      Saved
    </p>
  );
}
