"use client";

import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CompensationPlanEditorItem } from "@/actions/performance/getCompensationPlan";
import { saveCompensationPlanItem } from "@/actions/performance/saveCompensationPlanItem";
import type { CompensationPlanItemPatch } from "@/actions/performance/saveCompensationPlanItem.schema";
import { useAutosaveQueue } from "@/hooks/use-autosave-queue";
import type { Currency } from "@/lib/format/currency";
import {
  type CompensationPlanItemStatus,
  PLAN_LOCKED_MESSAGE,
} from "@/lib/performance/compensation-plan";
import {
  type CompUnit,
  canonicalCompUnit,
  compUnitText,
  convertCompUnit,
  roundForUnit,
} from "@/lib/performance/compensation-unit";
import type { Subratings } from "@/lib/performance/rating-rubric";
import { decodeLevelValue, encodeLevelValue } from "@/lib/staff/staff-rating";

/**
 * One row's editable state. `level` is the Select's encoded string, so typing or
 * clearing a control never fights the draft.
 *
 * The planned figure is held as THREE fields, which is what makes the annual/hourly
 * toggle lossless:
 *
 *  - `plannedCanonical` is the truth — the number that gets persisted, always in
 *    `canonicalUnit` (annual for salaried staff, hourly for hourly staff, matching
 *    what `plannedAmount` means in the database).
 *  - `plannedText` is the input's editing buffer, expressed in `plannedUnit`, so
 *    half-typed values like "1200." survive a re-render.
 *  - `plannedUnit` is pure display state: no patch ever reads it.
 *
 * Toggling the unit re-derives `plannedText` from the untouched `plannedCanonical`
 * and enqueues nothing. Converting the buffer in place instead would drift — a
 * 150,000 salary shown as 72.12/hr converts back to 150,010 — and would enqueue a
 * save of a number nobody typed.
 *
 * The discretionary bonus needs NO such split: it is a lump sum, so it has no unit
 * to be restated into and `plannedUnit` never touches it. Two fields suffice — the
 * value and its editing buffer.
 */
export type PlanRowDraft = {
  level: string;
  subratings: Subratings;
  /** The unit this person's stored figures are in. Seeded once; never edited. */
  canonicalUnit: CompUnit;
  /** The unit the row is currently displayed and typed in. */
  plannedUnit: CompUnit;
  /** The persisted value, in `canonicalUnit`. */
  plannedCanonical: number | null;
  /** The raw input text, in `plannedUnit`. */
  plannedText: string;
  /** The persisted lump-sum bonus. Unitless — never converted. */
  plannedBonus: number | null;
  /** The bonus input's editing buffer. */
  plannedBonusText: string;
  /** The currency BOTH proposed figures are in. */
  plannedCurrency: Currency | null;
  status: CompensationPlanItemStatus;
  evaluationNotes: string;
  compensationNotes: string;
};

/**
 * The save granularity. `planned` deliberately covers the row's WHOLE compensation
 * proposal — the ongoing amount, the lump-sum bonus, and the currency all three are
 * read in. An amount without a currency is uninterpretable (and the server rejects
 * it), so they must never be written apart; giving the bonus its own key would mean
 * two keys writing `plannedCurrency`, which is exactly the clobbering this per-field
 * split exists to prevent.
 */
export type PlanField =
  | "level"
  | "subratings"
  | "planned"
  | "status"
  | "evaluationNotes"
  | "compensationNotes";

/** Typing pauses need a beat; discrete controls save on the spot. */
const TEXT_DELAY_MS = 800;
const NUMBER_DELAY_MS = 600;

const DELAY_BY_FIELD: Partial<Record<PlanField, number>> = {
  planned: NUMBER_DELAY_MS,
  evaluationNotes: TEXT_DELAY_MS,
  compensationNotes: TEXT_DELAY_MS,
};

const IMMEDIATE_FIELDS: ReadonlySet<PlanField> = new Set<PlanField>([
  "level",
  "subratings",
  "status",
]);

const ALL_PLAN_FIELDS: readonly PlanField[] = [
  "level",
  "subratings",
  "planned",
  "status",
  "evaluationNotes",
  "compensationNotes",
];

export function draftFromItem(item: CompensationPlanEditorItem): PlanRowDraft {
  const unit = canonicalCompUnit(item.employmentType);
  return {
    level: encodeLevelValue(item.level),
    subratings: item.subratings,
    canonicalUnit: unit,
    // Rows open in the person's own unit — the figure as it is actually stored.
    plannedUnit: unit,
    plannedCanonical: item.plannedAmount,
    plannedText: item.plannedAmount == null ? "" : String(item.plannedAmount),
    plannedBonus: item.plannedBonus,
    plannedBonusText:
      item.plannedBonus == null ? "" : String(item.plannedBonus),
    // Seed the currency so the common same-currency case needs no interaction,
    // and an amount typed straight in always has a currency to go with it.
    plannedCurrency: item.plannedCurrency ?? item.live.currency ?? null,
    status: item.status,
    evaluationNotes: item.evaluationNotes ?? "",
    compensationNotes: item.compensationNotes ?? "",
  };
}

/** Parse the amount input. Blank or unparseable → no proposal. */
export function parsePlannedAmount(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

const KEY_SEPARATOR = "::";

function makeKey(itemId: string, field: PlanField): string {
  return `${itemId}${KEY_SEPARATOR}${field}`;
}

function parseKey(key: string): { itemId: string; field: PlanField } {
  const index = key.indexOf(KEY_SEPARATOR);
  return {
    itemId: key.slice(0, index),
    field: key.slice(index + KEY_SEPARATOR.length) as PlanField,
  };
}

/** Build the minimal patch for one field of one row. */
function patchFor(
  field: PlanField,
  draft: PlanRowDraft,
): CompensationPlanItemPatch {
  switch (field) {
    case "level":
      return { level: decodeLevelValue(draft.level) };
    case "subratings":
      return {
        subratings: Object.keys(draft.subratings).length
          ? draft.subratings
          : null,
      };
    case "planned":
      // Reads only the canonical value, so a display-unit toggle produces an
      // identical patch and `fieldEqual` drops it as a no-op. The bonus is already
      // unitless, so it is immune to that by construction.
      return {
        plannedAmount: draft.plannedCanonical,
        plannedBonus: draft.plannedBonus,
        plannedCurrency: draft.plannedCurrency,
      };
    case "status":
      return { status: draft.status };
    case "evaluationNotes":
      return { evaluationNotes: draft.evaluationNotes };
    case "compensationNotes":
      return { compensationNotes: draft.compensationNotes };
  }
}

/** Value-compare one field so an edit-and-revert doesn't hit the server. */
function fieldEqual(
  field: PlanField,
  a: PlanRowDraft,
  b: PlanRowDraft,
): boolean {
  return (
    JSON.stringify(patchFor(field, a)) === JSON.stringify(patchFor(field, b))
  );
}

/**
 * Save-on-edit for the compensation-plan editor.
 *
 * Holds the per-row draft and drives the shared {@link useAutosaveQueue} with one
 * key per (row, field), so two fields of the same row — or the same field of two
 * rows — never overwrite each other, and each write carries only what changed.
 *
 * The one failure it treats specially is the plan being committed underneath the
 * editor: retrying can never succeed, so the queue is abandoned, the editor is
 * marked locked, and the route is refreshed into its read-only rendering. Every
 * other failure stays queued for the next edit, blur or navigation to retry.
 */
export function usePlanAutosave(
  planId: string,
  items: CompensationPlanEditorItem[],
) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, PlanRowDraft>>(() =>
    Object.fromEntries(items.map((item) => [item.itemId, draftFromItem(item)])),
  );
  const [locked, setLocked] = useState(false);

  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  // What the server currently holds, per row — the baseline for no-op detection.
  const savedRef = useRef<Record<string, PlanRowDraft>>(drafts);
  const lockedRef = useRef(false);

  /**
   * Reconcile the drafts with the server payload whenever the plan's membership
   * changes (adding or removing staff calls `router.refresh()` rather than
   * remounting this hook).
   *
   * Rows already on screen keep their live draft — the person may be mid-edit,
   * and their unsaved keystrokes must survive a refresh triggered by an
   * unrelated row. Only genuinely new rows are seeded from the server, and
   * departed rows are dropped so their drafts and save baselines don't leak.
   *
   * Everything is computed in the effect body and the refs are written here,
   * NOT inside a `setDrafts` updater: updaters must be pure (React may call one
   * twice), and this project builds with the React Compiler, which relies on
   * that. `setDrafts` is called last with an already-final value.
   */
  useEffect(() => {
    const current = draftsRef.current;
    const next: Record<string, PlanRowDraft> = {};
    let changed = Object.keys(current).length !== items.length;
    for (const item of items) {
      const existing = current[item.itemId];
      if (!existing) changed = true;
      next[item.itemId] = existing ?? draftFromItem(item);
    }
    if (!changed) return;

    // Keep the save baseline in step, or a new row's first edit would compare
    // against nothing and be dropped as a no-op, and a departed row's would
    // linger forever.
    const nextSaved: Record<string, PlanRowDraft> = {};
    for (const item of items) {
      nextSaved[item.itemId] =
        savedRef.current[item.itemId] ?? next[item.itemId];
    }
    savedRef.current = nextSaved;
    draftsRef.current = next;
    setDrafts(next);
  }, [items]);

  const { executeAsync } = useAction(saveCompensationPlanItem);

  const save = useCallback(
    async (key: string): Promise<boolean> => {
      if (lockedRef.current) return true;

      const { itemId, field } = parseKey(key);
      const draft = draftsRef.current[itemId];
      const saved = savedRef.current[itemId];
      // The row was removed, or edited back to what the server already has.
      if (!draft) return true;
      if (saved && fieldEqual(field, draft, saved)) return true;

      const result = await executeAsync({
        planId,
        itemId,
        patch: patchFor(field, draft),
      }).catch(() => null);

      if (result?.data?.ok) {
        savedRef.current = { ...savedRef.current, [itemId]: draft };
        return true;
      }

      if (result?.serverError === PLAN_LOCKED_MESSAGE) {
        lockedRef.current = true;
        setLocked(true);
        // Not a retryable failure — report success so the queue stops, then let
        // the server re-render the page read-only.
        router.refresh();
        return true;
      }

      return false;
    },
    [executeAsync, planId, router],
  );

  const queue = useAutosaveQueue({ save });
  const { touch, abandon } = queue;

  // Once locked, nothing queued can ever succeed — drop it rather than let the
  // engine keep retrying against a plan the server will refuse.
  useEffect(() => {
    if (locked) abandon();
  }, [locked, abandon]);

  const setField = useCallback(
    (itemId: string, field: PlanField, patch: Partial<PlanRowDraft>) => {
      setDrafts((current) => {
        const existing = current[itemId];
        if (!existing) return current;
        return { ...current, [itemId]: { ...existing, ...patch } };
      });
      draftsRef.current = {
        ...draftsRef.current,
        [itemId]: { ...draftsRef.current[itemId], ...patch },
      };
      touch(makeKey(itemId, field), {
        immediate: IMMEDIATE_FIELDS.has(field),
        delayMs: DELAY_BY_FIELD[field],
      });
    },
    [touch],
  );

  /**
   * Update a row's draft WITHOUT enqueueing a save. For display-only state — the
   * annual/hourly unit — where touching the queue would write a value nobody
   * typed.
   */
  const setDisplayOnly = useCallback(
    (itemId: string, patch: Partial<PlanRowDraft>) => {
      setDrafts((current) => {
        const existing = current[itemId];
        if (!existing) return current;
        return { ...current, [itemId]: { ...existing, ...patch } };
      });
      draftsRef.current = {
        ...draftsRef.current,
        [itemId]: { ...draftsRef.current[itemId], ...patch },
      };
    },
    [],
  );

  /**
   * The person typed in the amount input. Keeps their exact text as the buffer and
   * derives the canonical value from it, converting out of the display unit.
   */
  const setPlannedText = useCallback(
    (itemId: string, text: string) => {
      const draft = draftsRef.current[itemId];
      if (!draft) return;
      const typed = parsePlannedAmount(text);
      setField(itemId, "planned", {
        plannedText: text,
        plannedCanonical:
          typed == null
            ? null
            : roundForUnit(
                convertCompUnit(typed, draft.plannedUnit, draft.canonicalUnit),
                draft.canonicalUnit,
              ),
      });
    },
    [setField],
  );

  /**
   * The person typed in the bonus input. No unit conversion happens here and none
   * should: a lump sum is the same number whether the row is showing annual or
   * hourly figures. Rounded to the two decimals `numeric(12, 2)` can hold, so what
   * is stored is what comes back.
   */
  const setPlannedBonusText = useCallback(
    (itemId: string, text: string) => {
      const typed = parsePlannedAmount(text);
      setField(itemId, "planned", {
        plannedBonusText: text,
        plannedBonus: typed == null ? null : Math.round(typed * 100) / 100,
      });
    },
    [setField],
  );

  /**
   * Set the canonical figure directly — the quick-raise picks, which compute in
   * canonical terms. The buffer is re-derived so the input shows it in whatever
   * unit the row is displaying.
   */
  const setPlannedCanonical = useCallback(
    (itemId: string, value: number | null) => {
      const draft = draftsRef.current[itemId];
      if (!draft) return;
      setField(itemId, "planned", {
        plannedCanonical: value,
        plannedText: compUnitText(
          value,
          draft.canonicalUnit,
          draft.plannedUnit,
        ),
      });
    },
    [setField],
  );

  /**
   * Switch the row's display unit. Re-derives the input buffer from the UNTOUCHED
   * canonical value — never from the rounded text on screen — so toggling back and
   * forth returns the identical figure, and enqueues nothing.
   */
  const setPlannedUnit = useCallback(
    (itemId: string, unit: CompUnit) => {
      const draft = draftsRef.current[itemId];
      if (!draft || draft.plannedUnit === unit) return;
      setDisplayOnly(itemId, {
        plannedUnit: unit,
        plannedText: compUnitText(
          draft.plannedCanonical,
          draft.canonicalUnit,
          unit,
        ),
      });
    },
    [setDisplayOnly],
  );

  /** Force one field to save now — the blur handler for text/number inputs. */
  const flushField = useCallback(
    (itemId: string, field: PlanField): Promise<boolean> =>
      queue.flush(makeKey(itemId, field)),
    [queue],
  );

  /** Force every pending field of one row to save (row collapse, removal). */
  const flushRow = useCallback(
    async (itemId: string): Promise<boolean> => {
      const results = await Promise.all(
        ALL_PLAN_FIELDS.map((field) => queue.flush(makeKey(itemId, field))),
      );
      return results.every(Boolean);
    },
    [queue],
  );

  /**
   * A row's live draft. Falls back to the server row so the single frame
   * between new items arriving and the reconciling effect running still renders
   * them — the caller never has to handle a missing draft.
   */
  const draftFor = useCallback(
    (item: CompensationPlanEditorItem): PlanRowDraft =>
      drafts[item.itemId] ?? draftFromItem(item),
    [drafts],
  );

  return {
    drafts,
    draftFor,
    locked,
    setField,
    setPlannedText,
    setPlannedBonusText,
    setPlannedCanonical,
    setPlannedUnit,
    flushField,
    flushRow,
    flushAll: queue.flushAll,
    fieldState: queue.state,
    isSaving: queue.isSaving,
    dirtyCount: queue.dirtyCount,
    keyFor: makeKey,
  };
}
