/**
 * Contact ↔ contact relationship kinds, their labels, and the copy helpers.
 *
 * One typed junction carries every person-to-person link, replacing the old
 * single-purpose `contacts.managerId` self-FK. Declared here as a pure,
 * client-importable module (no `db`/drizzle, no UI) so the pgEnum in
 * `crm-schema.ts`, the zod discriminated union in
 * `@/actions/crm/contactRelationship.schema`, the sidebar group captions, the
 * confirm/tooltip copy and the seed all derive from exactly one source of truth
 * — mirrors `./opportunity.ts`. See docs/domains/crm.md.
 */

export const CONTACT_RELATIONSHIP_KINDS = [
  // Directional: `contactId` reports to `relatedContactId`, both at the same
  // company. At most one per contact; the reverse lookup is their direct reports.
  "reports_to",
  // Directional: `contactId` (the NEW record, at the new employer) succeeds
  // `relatedContactId` (the OLD record). The same human as two rows — one each
  // way, so the chain is a linked list.
  "succeeds",
  // Symmetric, with a required free-text description. Stored once, read from
  // either side.
  "related",
] as const;

export type ContactRelationshipKind =
  (typeof CONTACT_RELATIONSHIP_KINDS)[number];

/**
 * The sidebar group captions — five, not three, because the two directional
 * kinds read differently from each end.
 *
 * Every caption is phrased from the *viewed* contact's point of view, which is
 * what makes direction unambiguous without any per-row copy: two rows under
 * "Reports to" and "Direct reports" need no "reports to them" suffix.
 */
export const CONTACT_RELATIONSHIP_GROUP_LABELS = {
  reportsTo: "Reports to",
  directReports: "Direct reports",
  succeeds: "Previously",
  succeededBy: "Moved to",
  related: "Also connected",
} as const;

/**
 * The `Type` options in the add dialog, in the order they're offered.
 *
 * `succeeds` is worded as **"Same person at a previous company"** rather than
 * anything about "records": the whole point is that the two rows are one human, and
 * the word "record" is the part a reader has to decode. Read the option as a
 * description of who you just picked in the field above it.
 */
export const CONTACT_RELATIONSHIP_KIND_LABELS: Record<
  ContactRelationshipKind,
  string
> = {
  reports_to: "Their manager",
  succeeds: "Same person at a previous company",
  related: "Other connection",
};

/** One line of help per kind, shown under the `Type` select. */
export const CONTACT_RELATIONSHIP_KIND_HINTS: Record<
  ContactRelationshipKind,
  string
> = {
  reports_to: "A colleague at the same company that this person reports to.",
  succeeds:
    "The same human, before they moved here — their old company's contact keeps its notes and history, and is set to inactive.",
  related: 'Any other tie, e.g. "Worked together at Acme".',
};

/**
 * Suggested wordings for a `related` link's description. **Suggestions only** —
 * the column is free text and nothing validates against this list, so the
 * wording can grow without a migration (same stance as
 * `./company-contact-relationship.ts`).
 */
export const CONTACT_RELATION_SUGGESTIONS = [
  "Worked together at a previous company",
  "Former colleague",
  "Introduced us",
  "Board peer",
  "Personal connection",
] as const;

/**
 * "Alice Reed (Acme)" — a person plus their employer as a **picker option label**.
 * Bracketed because it's a qualifier on a list item, not prose: the search results
 * for a succession are all the *same person's name*, so the employer is the only
 * thing telling the options apart, and parentheses read as "this one, the Acme one".
 * Falls back to the bare name when the employer is unknown.
 *
 * Use {@link atCompany} instead inside a sentence — see there for why the two
 * differ.
 */
export function nameWithEmployer(name: string, company: string | null): string {
  return company === null ? name : `${name} (${company})`;
}

/**
 * "Alice Reed at Acme" — the same pairing worded for **prose**: confirm-dialog
 * bodies and the sidebar's succession rows, where it sits mid-sentence.
 *
 * Deliberately NOT the bracketed {@link nameWithEmployer} form: "will no longer
 * continue Alice Reed (Acme)" reads like a citation, whereas "…continue Alice Reed
 * at Acme" reads like English. Two functions rather than one, because the two
 * contexts genuinely want different punctuation.
 */
export function atCompany(name: string, company: string | null): string {
  return company === null ? name : `${name} at ${company}`;
}

/**
 * The copy helpers below exist so the row captions, the dialog warnings, the
 * tooltips and the remove-confirm bodies can't drift apart — every full sentence
 * about a relationship is built here.
 */

/** The dialog's pre-submit warning: a succession deactivates the other record.
 * ("inactive" rather than "former" — see `./contact-status`.) */
export function successionSideEffectSentence(predecessor: string): string {
  return `Adding this marks ${predecessor} as inactive.`;
}

/** Why the `reports_to` option is missing: the slot is already taken. */
export function managerAlreadySetSentence(
  contact: string,
  manager: string,
): string {
  return `${contact} already reports to ${manager}. Remove that link first to change it.`;
}

/** Why the `reports_to` option is missing: a manager is scoped to a company. */
export const MANAGER_NEEDS_COMPANY_HINT =
  "Add a company to this contact to record who they report to.";
