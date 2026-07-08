/**
 * Fold pre-sorted rows into a Map keeping the FIRST row seen per key.
 *
 * The caller is responsible for ordering `rows` so the desired winner comes
 * first. The staff domain relies on this to pick the latest employment row per
 * person: rows queried `effectiveFromDate desc, createdAt desc` fold to the
 * newest fact per `staffId` (the effective-dating tiebreak — ADR 0007).
 */
export function firstPerKey<T, K>(
  rows: readonly T[],
  getKey: (row: T) => K,
): Map<K, T> {
  const byKey = new Map<K, T>();
  for (const row of rows) {
    const key = getKey(row);
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return byKey;
}
