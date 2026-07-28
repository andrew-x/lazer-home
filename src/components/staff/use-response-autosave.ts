"use client";

import { useAction } from "next-safe-action/hooks";
import { useCallback, useRef, useState } from "react";
import { upsertResponse } from "@/actions/responses/upsertResponse";
import type { UpsertResponseInput } from "@/actions/responses/upsertResponse.schema";
import { type SaveState, useAutosaveQueue } from "@/hooks/use-autosave-queue";

export type { SaveState };

/** The union of every survey's question ids the upsert action accepts. The
 * hook keeps ids as plain strings; the write validates them at the zod layer. */
type ResponseQuestionId = UpsertResponseInput["questionId"];

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
 * Autosave for the profile surveys (Manual of Me, Ways of Working). Each answer
 * persists independently via `upsertResponse` keyed by (staffId, questionId), so
 * a survey can be filled in any order, across sittings, with no big Submit.
 *
 * The queueing — one save in flight, edits during a save re-queued, failures left
 * queued for a later retry — lives in the shared `useAutosaveQueue` engine. What
 * stays here is what's survey-specific: the answer/`saved` maps, the
 * string-vs-list value semantics, and building the `upsertResponse` payload.
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

  // Refs mirror state so the save callback reads current values rather than the
  // ones captured when it was built.
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const savedRef = useRef(saved);
  savedRef.current = saved;

  const { executeAsync } = useAction(upsertResponse);

  const save = useCallback(
    async (id: string): Promise<boolean> => {
      const value = normalize(answersRef.current[id]);
      // Edited back to the saved value before the queue got here — nothing to do.
      if (equal(value, savedRef.current[id])) return true;

      const questionId = id as ResponseQuestionId;
      const res = await executeAsync(
        isList(value)
          ? { staffId, questionId, listResponse: value }
          : { staffId, questionId, textResponse: value },
      ).catch(() => null);

      if (!res?.data?.ok) return false;

      savedRef.current = { ...savedRef.current, [id]: value };
      setSaved((current) => ({ ...current, [id]: value }));
      return true;
    },
    [executeAsync, staffId],
  );

  const queue = useAutosaveQueue({ save, defaultDelayMs: DEBOUNCE_MS });
  const { touch } = queue;

  /** Update a field's value. Debounces a save unless `immediate`, in which case
   * the caller-visible change (chip/select) persists right away. */
  const setAnswer = useCallback(
    (id: string, value: ResponseValue, options?: { immediate?: boolean }) => {
      setAnswers((current) => ({ ...current, [id]: value }));
      answersRef.current = { ...answersRef.current, [id]: value };
      touch(id, options);
    },
    [touch],
  );

  return {
    answers,
    saved,
    fieldState: queue.state,
    setAnswer,
    flushField: queue.flush,
    flushAll: queue.flushAll,
  };
}
