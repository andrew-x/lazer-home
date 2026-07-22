import { z } from "zod";
import { optionalUrl } from "@/lib/schemas/url-schema";

/**
 * A pure, client-importable module (no `db`/drizzle) so the create/edit company
 * forms' resolvers and the server actions share one schema. See the "schema
 * modules by boundary" rule in `.claude/rules/server-actions.md`.
 */

/**
 * The user-facing company field refinements shared by create and update: a
 * required trimmed name, the shared optional-URL validator, and a partner flag
 * defaulting to false. Spread into both schemas so the two can't drift (mirrors
 * `opportunityBaseFields`); update layers `id` and `ownerId` on top.
 */
export const companyFields = {
  name: z.string().trim().min(1, "Name is required.").max(200),
  websiteUrl: optionalUrl,
  isPartner: z.boolean().default(false),
};

/**
 * Company create input — the shared `companyFields` refinements as their own
 * object. `id`/timestamps are DB-managed and omitted.
 */
export const createCompanySchema = z.object(companyFields);

export type CreateCompanyInput = z.input<typeof createCompanySchema>;
