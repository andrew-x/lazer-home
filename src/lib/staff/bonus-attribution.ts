/**
 * Attributing a bonus payment to an employment row — pure, client-safe, and the
 * only real logic in the bonus feature.
 *
 * A payment stores no line of business or role (see `staffBonusPayment`). The
 * dimensions are derived from the employment row that was in force **on the
 * payment date**, so a February bonus keeps counting under the discipline the
 * person held in February even after they move to another one in June. Last
 * year's totals therefore never silently rewrite themselves.
 */

/** The minimum an employment row must expose to be resolved against a date. */
type Dated = { effectiveFromDate: string };

/**
 * The employment row a payment on `date` should be attributed to: the most recent
 * row effective on or before that date.
 *
 * `rows` must be ordered newest-first (`latestEmploymentFirst`), which every
 * employment read already does — so the first row at or before the date wins,
 * including the same-day tie-break that ordering encodes.
 *
 * When a payment PREDATES all employment history — a signing bonus dated before
 * the first employment row, which is the normal case for a real signing bonus —
 * it falls back to the **earliest** row. The money was spent and has to land
 * somewhere; dropping it would silently under-report the total, which is worse
 * than attributing it to the role the person was hired into.
 *
 * Returns null only when the person has no employment rows at all, which the
 * caller must handle explicitly rather than treating as zero.
 *
 * Dates are `"YYYY-MM-DD"` wall-clock strings, compared lexicographically —
 * correct for that format, and no `Date` parsing means no timezone pitfalls.
 */
export function employmentAsOf<T extends Dated>(
  rows: readonly T[],
  date: string,
): T | null {
  if (rows.length === 0) return null;

  const inForce = rows.find((row) => row.effectiveFromDate <= date);
  // rows is newest-first, so the last element is the earliest row.
  return inForce ?? rows[rows.length - 1];
}
