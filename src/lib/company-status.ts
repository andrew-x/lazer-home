/**
 * A company's status is **derived**, not stored: it's a set of tags computed
 * from the company's relationships. Declared here as a pure, client-importable
 * module (no `db`/drizzle, no UI) so the read that computes the underlying
 * flags (`getCompaniesPage`) and the UI that renders the badges share exactly
 * one definition of the tags, their order, and their labels — mirrors the
 * derived-field pattern in `project-derived.ts`. See docs/domains/crm.md.
 *
 * - **Partner**  — the manual `companies.isPartner` flag.
 * - **Client**   — has at least one confirmed project.
 * - **Prospect** — has at least one open (non-closed) opportunity.
 *
 * The flags are independent: a company can carry several tags at once (e.g. a
 * partner who is also a client with a live extension in the pipeline).
 */

/** The derived flags backing a company's status tags. */
export type CompanyStatusFlags = {
  isPartner: boolean;
  isClient: boolean;
  isProspect: boolean;
};

/** A single status tag, in canonical order. */
export const COMPANY_STATUS_TAGS = ["partner", "client", "prospect"] as const;

export type CompanyStatusTag = (typeof COMPANY_STATUS_TAGS)[number];

/** Human-readable labels for each status tag. */
export const COMPANY_STATUS_LABELS: Record<CompanyStatusTag, string> = {
  partner: "Partner",
  client: "Client",
  prospect: "Prospect",
};

const TAG_PREDICATES: Record<
  CompanyStatusTag,
  (f: CompanyStatusFlags) => boolean
> = {
  partner: (f) => f.isPartner,
  client: (f) => f.isClient,
  prospect: (f) => f.isProspect,
};

/**
 * The status tags that apply to a company, in canonical order. Returns an empty
 * array when none apply.
 */
export function companyStatusTags(
  flags: CompanyStatusFlags,
): CompanyStatusTag[] {
  return COMPANY_STATUS_TAGS.filter((tag) => TAG_PREDICATES[tag](flags));
}
