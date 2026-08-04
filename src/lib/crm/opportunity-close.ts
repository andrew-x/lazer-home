/**
 * When a deal was **decided** — the rule for maintaining `opportunities.closedAt`,
 * as a pure function. A client-importable module (no `db`/drizzle) so the
 * transition table itself is unit tested, while the three writers that call it
 * stay in the actions layer.
 *
 * Why a dedicated column at all: `updatedAt` already answers "when did anything
 * about this row change", which is the wrong question. Renaming a deal won last
 * year, or nudging its card inside the Won column, bumps `updatedAt` — and would
 * move the deal into this week's "closed won" figure on the home dashboard. Only
 * a close-specific instant can answer "what did we win this week".
 *
 * The `opportunities_closed_at_shape` CHECK constraint enforces this rule in the
 * database: `closedAt` is non-null exactly when the status is terminal. So a
 * writer that forgets to call `closedAtFor` fails loudly rather than quietly
 * skewing a figure. See docs/decisions/0069.
 */
import {
  CLOSED_OPPORTUNITY_STATUSES,
  type OpportunityStatus,
} from "@/lib/crm/opportunity";

const CLOSED: ReadonlySet<string> = new Set(CLOSED_OPPORTUNITY_STATUSES);

/**
 * Is this a terminal status — the deal has been decided, won or lost? Derived
 * from `CLOSED_OPPORTUNITY_STATUSES` so the two statuses are never re-listed.
 */
export function isClosedStatus(status: OpportunityStatus): boolean {
  return CLOSED.has(status);
}

/**
 * The `closedAt` a status write must persist.
 *
 * - **open → closed** — `now`. The deal was decided just now.
 * - **closed → closed** — `previous`. `closed_won` → `closed_lost` is a
 *   *correction* of an existing decision, not a new one; and re-saving a won deal
 *   or re-dragging its card inside the Won column must not move it into this
 *   week, which is the entire reason this isn't `updatedAt`. Falls back to `now`
 *   if no previous instant was recorded (a row that predates this column and
 *   somehow escaped the backfill) so the CHECK is never violated.
 * - **closed → open** — `null`. The deal was reopened; it has no close date again.
 * - **open → open** — `null`.
 *
 * Returns an **explicit value in every case**, never `undefined`, so a caller
 * cannot accidentally spread this into an update and leave the column untouched.
 *
 * `now` is a parameter rather than a `new Date()` inside, which keeps this pure
 * and the tests deterministic.
 *
 * @param prevStatus the status being replaced, or `null` on insert
 */
export function closedAtFor(
  prevStatus: OpportunityStatus | null,
  nextStatus: OpportunityStatus,
  now: Date,
  previous: Date | null = null,
): Date | null {
  if (!isClosedStatus(nextStatus)) return null;
  if (prevStatus !== null && isClosedStatus(prevStatus)) return previous ?? now;
  return now;
}
