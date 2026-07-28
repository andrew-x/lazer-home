"use client";

import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CompensationPlanEditorItem } from "@/actions/performance/getCompensationPlan";
import { saveCompensationPlanItem } from "@/actions/performance/saveCompensationPlanItem";
import type { CompensationPlanItemPatch } from "@/actions/performance/saveCompensationPlanItem.schema";
import { useAutosaveQueue } from "@/hooks/use-autosave-queue";
import type { Currency } from "@/lib/format/currency";
import { PLAN_LOCKED_MESSAGE } from "@/lib/performance/compensation-plan";
import type { Subratings } from "@/lib/performance/rating-rubric";
import { decodeLevelValue, encodeLevelValue } from "@/lib/staff/staff-rating";

/**
 * One row's editable state. `level` is the Select's encoded string and
 * `plannedAmount` the raw input text — both kept in the form the control uses, so
 * typing "1200." or clearing a field never fights the draft.
 */
export type PlanRowDraft = {
  level: string;
  subratings: Subratings;
  plannedAmount: string;
  plannedCurrency: Currency | null;
  ratingDone: boolean;
  meetingDone: boolean;
  isComplete: boolean;
  evaluationNotes: string;
  compensationNotes: string;
};

/**
 * The save granularity. `planned` deliberately covers the amount AND its currency
 * as one unit: an amount without a currency is uninterpretable (and the server
 * rejects it), so the pair must never be written apart.
 */
export type PlanField =
  | "level"
  | "subratings"
  | "planned"
  | "ratingDone"
  | "meetingDone"
  | "isComplete"
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
  "ratingDone",
  "meetingDone",
  "isComplete",
]);

const ALL_PLAN_FIELDS: readonly PlanField[] = [
  "level",
  "subratings",
  "planned",
  "ratingDone",
  "meetingDone",
  "isComplete",
  "evaluationNotes",
  "compensationNotes",
];

export function draftFromItem(item: CompensationPlanEditorItem): PlanRowDraft {
  return {
    level: encodeLevelValue(item.level),
    subratings: item.subratings,
    plannedAmount: item.plannedAmount == null ? "" : String(item.plannedAmount),
    // Seed the currency so the common same-currency case needs no interaction,
    // and an amount typed straight in always has a currency to go with it.
    plannedCurrency: item.plannedCurrency ?? item.live.currency ?? null,
    ratingDone: item.ratingDone,
    meetingDone: item.meetingDone,
    isComplete: item.isComplete,
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
      return {
        plannedAmount: parsePlannedAmount(draft.plannedAmount),
        plannedCurrency: draft.plannedCurrency,
      };
    case "ratingDone":
      return { ratingDone: draft.ratingDone };
    case "meetingDone":
      return { meetingDone: draft.meetingDone };
    case "isComplete":
      return { isComplete: draft.isComplete };
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
    flushField,
    flushRow,
    flushAll: queue.flushAll,
    fieldState: queue.state,
    isSaving: queue.isSaving,
    dirtyCount: queue.dirtyCount,
    keyFor: makeKey,
  };
}
