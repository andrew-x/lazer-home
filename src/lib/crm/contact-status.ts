/**
 * A contact's active/inactive status — the display side of `contacts.isActive`. A
 * pure, client-importable module (no `db`/drizzle) so the badge on four different
 * tables, the edit dialog's switch, and the relationship copy all say the same
 * words (mirrors `./relationship-strength`).
 *
 * **Why "inactive" rather than "former":** "former" only describes one of the cases
 * — someone who left the company on the record. The flag is broader than that: it
 * also covers a record that's simply no longer relevant or valid (a duplicate, a
 * bad address, someone we no longer deal with). "Inactive" covers all of it without
 * asserting a reason, and {@link INACTIVE_EXPLANATION} spells the range out
 * wherever there's room to.
 */

export const ACTIVE_LABEL = "Active";
export const INACTIVE_LABEL = "Inactive";

/** The badge/switch word for a stored value. */
export function contactStatusLabel(isActive: boolean): string {
  return isActive ? ACTIVE_LABEL : INACTIVE_LABEL;
}

/**
 * What "inactive" means, for the edit dialog where there's room to explain it.
 * Deliberately names *both* cases, because the status is set for either and the
 * record itself doesn't record which.
 */
export const INACTIVE_EXPLANATION =
  "Inactive means this record isn't one to work from any more — the person no longer works at that company, or the record itself is no longer relevant or valid. Inactive contacts are hidden from the contacts list unless you include them.";

/**
 * The narrower explanation for a record that a succession link set inactive: here
 * we *do* know the reason, so say it rather than listing the possibilities.
 */
export const INACTIVE_BY_SUCCESSION_EXPLANATION =
  "Set to inactive automatically because a newer record for this person exists elsewhere.";
