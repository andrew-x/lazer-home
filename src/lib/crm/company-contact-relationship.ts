/**
 * Non-employee company ↔ contact relationships: the suggested descriptions.
 *
 * `contacts.companyId` says where a person *works*; a relationship row says how
 * a person relates to a company they *don't* work at — a partner's CSM on one of
 * our accounts, an embedded FDE, a former employee, an investor on the board.
 *
 * These are **suggestions only**: `companyContactRelationships.description` is
 * free text and nothing validates against this list, so the wording can grow
 * without a migration (contrast the closed pgEnum tuples in `./opportunity.ts`,
 * where the tuple is the source of truth for both the enum and the zod schema).
 * A pure, client-importable module (no `db`/drizzle) so the dialog's autocomplete
 * and the seed share one list — it's a handful of short strings, so bundling it
 * is free.
 */

export const RELATIONSHIP_DESCRIPTION_SUGGESTIONS = [
  "CSM",
  "FDE",
  "Partner manager",
  "Former employee",
  "Investor",
] as const;
