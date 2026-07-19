"use client";

import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { upsertResponse } from "@/actions/responses/upsertResponse";
import type { UpsertResponseInput } from "@/actions/responses/upsertResponse.schema";

/** The union of every survey's question ids the upsert action accepts. The
 * hook keeps ids as plain strings; the write validates them at the zod layer. */
type ResponseQuestionId = UpsertResponseInput["questionId"];

export type SaveState = "idle" | "saving" | "saved" | "error";

/** A field's live value: a string for free-text / single-select questions, a
 * string[] for multi-select / matrix questions. The shape (and thus which
 * `responses` column is written) is inferred from the value at save time. */
export type ResponseValue = string | string[];

const DEBOUNCE_MS = 800;

function isList(value: ResponseValue): value is string[] {
  return Array.isArray(value);
}

/** Trim free-text; leave lists as-is. Used for both dirty detection and the
 * value we persist, so "saved" only lights up when the field truly matches. */
function normalize(value: ResponseValue): ResponseValue {
  return isList(value) ? value : value.trim();
}

function equal(a: ResponseValue, b: ResponseValue): boolean {
  if (isList(a) && isList(b)) {
    return a.length === b.length && a.every((item, i) => item === b[i]);
  }
  if (!isList(a) && !isList(b)) return a === b;
  return false;
}

/** Whether a field is unanswered (empty string / empty list). */
export function isEmpty(value: ResponseValue): boolean {
  return isList(value) ? value.length === 0 : value === "";
}

/**
 * The autosave engine shared by the profile surveys (Manual of Me, Ways of
 * Working). Each answer persists independently via `upsertResponse` keyed by
 * (staffId, questionId), so a survey can be filled in any order, across
 * sittings, with no big Submit.
 *
 * Saves run one at a time through a drain loop over a dirty-set of question
 * ids: an edit that lands mid-save re-queues its field, a failed save re-queues
 * and stops (a later edit/blur/navigation retries), and the per-field "saved"
 * indicator only lights up when the field still matches what we sent — so
 * typing through a save never shows a stale ✓. This queueing is what keeps
 * rapid multi-field edits from dropping an intermediate answer.
 *
 * `setAnswer` debounces a save while typing; `flushField`/`flushAll` force an
 * immediate save (blur, navigation, unmount, Done). `flushAll` returns false if
 * any save failed, so a caller can refuse to navigate away from unsaved work.
 */
export function useResponseAutosave(
  staffId: string,
  initial: Record<string, ResponseValue>,
) {
  const [answers, setAnswers] = useState<Record<string, ResponseValue>>(
    () => initial,
  );
  // Last value persisted per question (normalized). Drives dirty detection and
  // the "answered" indicators.
  const [saved, setSaved] = useState<Record<string, ResponseValue>>(() => {
    const next: Record<string, ResponseValue> = {};
    for (const [id, value] of Object.entries(initial))
      next[id] = normalize(value);
    return next;
  });
  const [fieldState, setFieldState] = useState<Record<string, SaveState>>({});

  // Refs mirror state so timers, async callbacks, and unmount cleanup read
  // current values without going stale in a closure.
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const savedRef = useRef(saved);
  savedRef.current = saved;

  // A drain is in flight (only one save runs at a time), plus the set of
  // question ids with unsaved edits waiting to be persisted, and per-id
  // debounce timers.
  const savingRef = useRef(false);
  const dirtyRef = useRef<Set<string>>(new Set());
  const drainRef = useRef<Promise<boolean> | null>(null);
  const debounceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const { executeAsync } = useAction(upsertResponse);

  const markState = useCallback((id: string, state: SaveState) => {
    setFieldState((current) => ({ ...current, [id]: state }));
  }, []);

  const drain = useCallback(async (): Promise<boolean> => {
    savingRef.current = true;
    let ok = true;
    try {
      while (dirtyRef.current.size > 0) {
        const id = dirtyRef.current.values().next().value;
        if (id === undefined) break;
        dirtyRef.current.delete(id);

        const value = normalize(answersRef.current[id]);
        // Edited back to the saved value before we got here — nothing to do.
        if (equal(value, savedRef.current[id])) continue;

        markState(id, "saving");
        const questionId = id as ResponseQuestionId;
        const res = await executeAsync(
          isList(value)
            ? { staffId, questionId, listResponse: value }
            : { staffId, questionId, textResponse: value },
        ).catch(() => null);

        if (res?.data?.ok) {
          savedRef.current = { ...savedRef.current, [id]: value };
          setSaved((current) => ({ ...current, [id]: value }));
          // Changed again while this save was in flight → dirty once more.
          const live = normalize(answersRef.current[id]);
          if (!equal(live, value)) dirtyRef.current.add(id);
          markState(id, equal(live, savedRef.current[id]) ? "saved" : "saving");
        } else {
          // Leave it queued so a later edit/blur/navigation retries it.
          dirtyRef.current.add(id);
          markState(id, "error");
          ok = false;
          break;
        }
      }
    } finally {
      savingRef.current = false;
    }
    return ok;
  }, [executeAsync, markState, staffId]);

  const enqueue = useCallback((id: string) => {
    if (!equal(normalize(answersRef.current[id]), savedRef.current[id])) {
      dirtyRef.current.add(id);
    }
  }, []);

  /** Force-save one field (blur / immediate change). Never rejects. */
  const flushField = useCallback(
    (id: string): Promise<boolean> => {
      const timer = debounceRef.current.get(id);
      if (timer) {
        clearTimeout(timer);
        debounceRef.current.delete(id);
      }
      enqueue(id);
      if (savingRef.current) return drainRef.current ?? Promise.resolve(true);
      if (dirtyRef.current.size === 0) return Promise.resolve(true);
      drainRef.current = drain();
      return drainRef.current;
    },
    [drain, enqueue],
  );

  /** Force-save every field with unsaved edits (navigation / Done / unmount). */
  const flushAll = useCallback((): Promise<boolean> => {
    for (const timer of debounceRef.current.values()) clearTimeout(timer);
    debounceRef.current.clear();
    for (const id of Object.keys(answersRef.current)) enqueue(id);
    if (savingRef.current) return drainRef.current ?? Promise.resolve(true);
    if (dirtyRef.current.size === 0) return Promise.resolve(true);
    drainRef.current = drain();
    return drainRef.current;
  }, [drain, enqueue]);

  /** Update a field's value. Debounces a save unless `immediate`, in which case
   * the caller-visible change (chip/select) persists right away. */
  const setAnswer = useCallback(
    (id: string, value: ResponseValue, options?: { immediate?: boolean }) => {
      setAnswers((current) => ({ ...current, [id]: value }));
      answersRef.current = { ...answersRef.current, [id]: value };
      // A fresh edit clears any "saved/error" indicator for this field.
      setFieldState((current) =>
        current[id] && current[id] !== "idle"
          ? { ...current, [id]: "idle" }
          : current,
      );

      const existing = debounceRef.current.get(id);
      if (existing) clearTimeout(existing);

      if (options?.immediate) {
        debounceRef.current.delete(id);
        void flushField(id);
        return;
      }
      debounceRef.current.set(
        id,
        setTimeout(() => {
          debounceRef.current.delete(id);
          void flushField(id);
        }, DEBOUNCE_MS),
      );
    },
    [flushField],
  );

  // Best-effort save if the component unmounts mid-edit (e.g. browser back).
  useEffect(() => {
    return () => {
      void flushAll();
    };
  }, [flushAll]);

  return {
    answers,
    saved,
    fieldState,
    setAnswer,
    flushField,
    flushAll,
  };
}
