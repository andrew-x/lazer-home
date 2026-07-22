"use server";

import { and, asc, eq, ilike } from "drizzle-orm";
import { z } from "zod";
import { secureActionClient } from "@/lib/core/action";
import { escapeLike } from "@/lib/core/like";
import { SEARCH_LIMIT, searchQuerySchema } from "@/lib/core/search";
import { db } from "@/lib/db/db";
import { projects } from "@/lib/db/schema";

/**
 * Type-ahead search backing the "associate an existing project" picker in the
 * opportunity planner. **Company-scoped** — `companyId` is required and filters
 * results to that company, so an opportunity can only be linked to a project of
 * its own company (the same-company invariant, enforced structurally here and
 * asserted again in `associateOpportunityProject`). Gated on `projects.edit`
 * (associating is a delivery decision). Blank query → nothing.
 */
export const searchProjects = secureActionClient
  .metadata({
    action: "search-projects",
    permission: { projects: ["edit"] },
  })
  .inputSchema(
    // `companyId` is nullish so the action still satisfies the generic
    // `SearchAction` contract (input reducible to `{ query }`); the picker always
    // supplies it via `searchArgs`, and a missing scope returns nothing.
    searchQuerySchema.extend({
      companyId: z.string().min(1).nullish(),
    }),
  )
  .action(async ({ parsedInput: { query, companyId } }) => {
    if (query === "" || !companyId) return [];

    return db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(
        and(
          eq(projects.companyId, companyId),
          ilike(projects.name, `%${escapeLike(query)}%`),
        ),
      )
      .orderBy(asc(projects.name))
      .limit(SEARCH_LIMIT);
  });
