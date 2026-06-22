"use client";

import { useEffect, useState } from "react";

/**
 * Returns a copy of `value` that only updates after it has stopped changing for
 * `delayMs`. Use to throttle expensive reactions to fast-changing input (e.g. a
 * server-backed type-ahead search).
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
