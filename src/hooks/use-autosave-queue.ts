"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * The generic save-on-edit engine: a dirty set of keys, per-key debounce timers,
 * and a single-flight drain loop that persists them one at a time.
 *
 * It deliberately knows nothing about *what* a key means or what gets sent. The
 * caller supplies `save(key)`, which reads whatever the current value is, decides
 * whether it differs from what was last persisted, sends it, and reports success.
 * That split is the only clean seam between the two surfaces that autosave — the
 * profile surveys (key = question id) and the compensation-plan editor
 * (key = `itemId:field`) — whose value shapes and comparison rules have nothing
 * in common.
 *
 * Concurrency rules, which are the whole point of the queue:
 *
 *  - **One save in flight at a time.** Without this, two edits to the same field
 *    can land out of order and the older value wins.
 *  - **An edit during a save re-queues itself.** `touch` re-adds the key while
 *    the drain is awaiting, and the loop picks it up on the next turn — so a fast
 *    typist never loses the last keystroke.
 *  - **A failed save stays queued** (and stops the drain) so a later edit, blur,
 *    or unmount retries it, rather than silently dropping the edit.
 *  - **"Saved" only shows when the key is genuinely clean**, so typing through a
 *    save never flashes a stale tick.
 */
export function useAutosaveQueue<TKey extends string = string>({
  save,
  defaultDelayMs = 600,
}: {
  /** Persist one key. Return false to signal failure (and keep it queued). */
  save: (key: TKey) => Promise<boolean>;
  defaultDelayMs?: number;
}) {
  const [state, setState] = useState<Record<string, SaveState>>({});
  const [pending, setPending] = useState({ saving: false, dirty: 0 });

  const dirtyRef = useRef<Set<TKey>>(new Set());
  const timersRef = useRef<Map<TKey, ReturnType<typeof setTimeout>>>(new Map());
  const savingRef = useRef(false);
  const drainRef = useRef<Promise<boolean> | null>(null);

  // `save` is rebuilt on most renders (it closes over current values); keep it in
  // a ref so the drain loop always calls the latest one without being rebuilt
  // itself — a changing drain identity would break the single-flight guarantee.
  const saveRef = useRef(save);
  saveRef.current = save;

  const syncPending = useCallback(() => {
    setPending({ saving: savingRef.current, dirty: dirtyRef.current.size });
  }, []);

  const markState = useCallback((key: TKey, next: SaveState) => {
    setState((current) => ({ ...current, [key]: next }));
  }, []);

  const drain = useCallback(async (): Promise<boolean> => {
    savingRef.current = true;
    syncPending();
    let ok = true;
    try {
      while (dirtyRef.current.size > 0) {
        const key = dirtyRef.current.values().next().value;
        if (key === undefined) break;
        dirtyRef.current.delete(key);

        markState(key, "saving");
        const saved = await saveRef.current(key).catch(() => false);

        if (saved) {
          // Re-dirtied while this save was in flight → it will come round again;
          // don't claim "saved" for a value that's already superseded.
          markState(key, dirtyRef.current.has(key) ? "saving" : "saved");
        } else {
          dirtyRef.current.add(key);
          markState(key, "error");
          ok = false;
          break;
        }
      }
    } finally {
      savingRef.current = false;
      syncPending();
    }
    return ok;
  }, [markState, syncPending]);

  const startDrain = useCallback((): Promise<boolean> => {
    if (savingRef.current) return drainRef.current ?? Promise.resolve(true);
    if (dirtyRef.current.size === 0) return Promise.resolve(true);
    drainRef.current = drain();
    return drainRef.current;
  }, [drain]);

  const clearTimer = useCallback((key: TKey) => {
    const timer = timersRef.current.get(key);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(key);
    }
  }, []);

  /** Persist one key now (blur, discrete control, collapse). Never rejects. */
  const flush = useCallback(
    (key: TKey): Promise<boolean> => {
      clearTimer(key);
      return startDrain();
    },
    [clearTimer, startDrain],
  );

  /**
   * Persist everything outstanding (navigation, unmount, before an action that
   * must not run against stale data). Resolves false if any save failed, so a
   * caller can refuse to proceed.
   */
  const flushAll = useCallback((): Promise<boolean> => {
    for (const timer of timersRef.current.values()) clearTimeout(timer);
    timersRef.current.clear();
    return startDrain();
  }, [startDrain]);

  /**
   * Mark a key dirty. Debounced by `delayMs` (or the queue default); `immediate`
   * saves on the spot — the right choice for discrete controls like checkboxes
   * and selects, where there is no "still typing" to wait out.
   */
  const touch = useCallback(
    (key: TKey, options?: { delayMs?: number; immediate?: boolean }) => {
      dirtyRef.current.add(key);
      syncPending();
      // A fresh edit clears any lingering saved/error tick for this key.
      setState((current) =>
        current[key] && current[key] !== "idle"
          ? { ...current, [key]: "idle" }
          : current,
      );

      clearTimer(key);
      if (options?.immediate) {
        void flush(key);
        return;
      }
      timersRef.current.set(
        key,
        setTimeout(() => {
          timersRef.current.delete(key);
          void startDrain();
        }, options?.delayMs ?? defaultDelayMs),
      );
    },
    [clearTimer, defaultDelayMs, flush, startDrain, syncPending],
  );

  /**
   * Abandon all queued work without saving. For the cases where retrying is
   * pointless rather than merely failed — the row was deleted, or the record was
   * locked by someone else and the server will reject every further write.
   */
  const abandon = useCallback(() => {
    for (const timer of timersRef.current.values()) clearTimeout(timer);
    timersRef.current.clear();
    dirtyRef.current.clear();
    syncPending();
  }, [syncPending]);

  // Best-effort save if the component unmounts mid-edit (soft navigation, back).
  useEffect(() => {
    return () => {
      void flushAll();
    };
  }, [flushAll]);

  return {
    state,
    touch,
    flush,
    flushAll,
    abandon,
    isSaving: pending.saving,
    dirtyCount: pending.dirty,
  };
}
