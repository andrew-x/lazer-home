"use server";

import { asc, ilike } from "drizzle-orm";
import { secureActionClient } from "@/lib/core/action";
import { escapeLike } from "@/lib/core/like";
import { SEARCH_LIMIT } from "@/lib/core/search";
import { db } from "@/lib/db/db";
import { opportunities, projects } from "@/lib/db/schema";
import { searchTranscriptTargetsSchema } from "./transcript.schema";

/**
 * Type-ahead over the records a transcript can be filed to, for the assign dialog.
 *
 * ## This action is deliberately UNGATED, and that is a disclosure
 *
 * Any signed-in user can enumerate every project **and every opportunity** by name
 * through this action — including the many they cannot file to, since
 * `assignTranscript` requires `crm.edit` / `projects.edit`. Project names are
 * already broadly disclosed (the utilization report is open to every signed-in
 * user), but **the opportunity list is not**: nothing else in the app exposes client
 * and deal names outside `crm.edit`.
 *
 * That cost was raised twice during planning and accepted both times; it is recorded
 * in ADR 0072 and in `docs/domains/permissions.md`'s "An accepted disclosure"
 * section. It is written down rather than left implicit precisely because an
 * ungated read of the deal list is the kind of thing an audit should find already
 * explained — if you are reading this because `/audit-rbac` flagged it, this is the
 * explanation, not an oversight.
 *
 * **If that decision is ever revisited**, the fix is small and local: add
 * `authorize: authorizeDriveFolder` to the metadata below. The hook already resolves
 * `crm.edit`/`projects.edit` from the same `kind` this body switches on, so the gate
 * and the table cannot disagree. Nothing else needs to change.
 *
 * One action rather than two (one per kind), so the whole disclosure is a single
 * auditable surface rather than something to reassemble from two files. The existing
 * `searchProjects` is deliberately **left alone** — it is company-scoped and gated on
 * `projects.edit`, and other callers depend on both.
 */
export const searchTranscriptTargets = secureActionClient
  .metadata({ action: "search-transcript-targets" })
  .inputSchema(searchTranscriptTargetsSchema)
  .action(async ({ parsedInput: { query, kind } }) => {
    // A missing kind returns nothing rather than defaulting to a table — see the
    // note on the schema for why it is nullish at all.
    if (query === "" || !kind) return [];

    const pattern = `%${escapeLike(query)}%`;

    if (kind === "sales") {
      return db
        .select({ id: opportunities.id, name: opportunities.name })
        .from(opportunities)
        .where(ilike(opportunities.name, pattern))
        .orderBy(asc(opportunities.name))
        .limit(SEARCH_LIMIT);
    }

    return db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(ilike(projects.name, pattern))
      .orderBy(asc(projects.name))
      .limit(SEARCH_LIMIT);
  });
