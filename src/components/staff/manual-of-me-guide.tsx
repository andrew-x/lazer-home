"use client";

import { IconArrowLeft, IconArrowRight } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { ManualOfMeEntry } from "@/actions/responses/getManualOfMe";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { SaveIndicator } from "./response-save-indicator";
import { isEmpty, useResponseAutosave } from "./use-response-autosave";

/**
 * The guided Manual of Me editor: one question at a time, so filling it out
 * feels like a calm conversation rather than a wall of textareas. Each answer
 * autosaves — on blur, after a short pause in typing, and whenever you move
 * between questions — so nobody has to finish in one sitting (a few of these
 * questions explicitly invite coming back later). There is no big Submit: the
 * "Done" button just returns to the profile. The save-queue lives in
 * `useResponseAutosave`, shared with the Ways of Working survey.
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

  const { answers, saved, fieldState, setAnswer, flushField, flushAll } =
    useResponseAutosave(
      staffId,
      Object.fromEntries(entries.map((e) => [e.id, e.textResponse ?? ""])),
    );

  const current = entries[step];
  const currentId = current.id;
  const isLast = step === total - 1;

  const goTo = useCallback(
    (target: number) => {
      if (target < 0 || target >= total || target === step) return;
      void flushAll();
      setStep(target);
    },
    [flushAll, step, total],
  );

  async function finish() {
    // Unlike the best-effort saves elsewhere, Finish must not lose a last-second
    // keystroke: await the full drain and stay put (surfacing the error) rather
    // than navigating away from unsaved work.
    const ok = await flushAll();
    if (!ok) return;
    router.push(`/staff/${staffId}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <StepRail
        step={step}
        answered={entries.map((entry) => !isEmpty(saved[entry.id] ?? ""))}
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
          key={currentId}
          value={(answers[currentId] as string) ?? ""}
          onChange={(event) => setAnswer(currentId, event.target.value)}
          onBlur={() => void flushField(currentId)}
          placeholder="Take your time — write as much or as little as feels right."
          className="min-h-48 flex-1"
          autoFocus
        />

        <SaveIndicator state={fieldState[currentId] ?? "idle"} />
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

// StepRail below; SaveIndicator now lives in ./response-save-indicator.

/**
 * The step rail: "Question n of total" plus a row of clickable segments — one
 * per question — that double as progress and a jump nav. Flat by design (no
 * shadow); the current step reads in the accent, answered ones in foreground,
 * the rest muted.
 */
function StepRail({
  step,
  answered,
  onJump,
  titles,
}: {
  step: number;
  answered: boolean[];
  onJump: (target: number) => void;
  titles: string[];
}) {
  const answeredCount = answered.filter(Boolean).length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">
          Question {step + 1} of {titles.length}
        </span>
        <span className="text-xs text-muted-foreground">
          {answeredCount} answered
        </span>
      </div>
      <div className="flex gap-1.5">
        {titles.map((title, index) => {
          const isCurrent = index === step;
          return (
            <button
              key={title}
              type="button"
              onClick={() => onJump(index)}
              aria-label={`Go to question ${index + 1}: ${title}`}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                isCurrent
                  ? "bg-primary"
                  : answered[index]
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
