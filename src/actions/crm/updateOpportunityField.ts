"use server";

import { eq, type InferInsertModel } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { opportunities } from "@/lib/db/schema";
import { assertOpportunityTransitionAllowed } from "./assertOpportunityTransitionAllowed";
import { confirmRolesOnWon } from "./confirmRolesOnWon";
import {
  replaceOpportunityContacts,
  replaceOpportunityOwners,
  replaceOpportunitySourceContacts,
  replaceOpportunitySourceStaff,
} from "./opportunityLinks";
import { updateOpportunityFieldSchema } from "./updateOpportunityField.schema";

/** `db` or a transaction handle — both expose the `.update` used below. */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
type OpportunityUpdate = Partial<InferInsertModel<typeof opportunities>>;

/**
 * Edit a *single* field of an opportunity from the detail drawer. Gated on
 * `crm.edit`. A discriminated union on `field`: each variant writes only the
 * slice that changed instead of re-sending the whole record, so concurrent
 * edits to other fields aren't clobbered and unrelated people junctions aren't
 * rewritten (mirrors `updateContactOwner`). Status changes route through the
 * shared `assertOpportunityTransitionAllowed` — ADR 0024's one enforcement.
 * Every write is `.returning()`-guarded so a row deleted out from under the edit
 * surfaces as a clean error; junction edits touch the row too (bumping
 * `updatedAt`) to guard existence and mark the opportunity modified.
 */
export const updateOpportunityField = secureActionClient
  .metadata({
    action: "update-opportunity-field",
    permission: { crm: ["edit"] },
  })
  .inputSchema(updateOpportunityFieldSchema)
  .action(async ({ parsedInput }) => {
    const { id } = parsedInput;

    // Single-row set guarded by `.returning()` — a missing row means it was
    // deleted mid-edit. `$onUpdate` bumps `updatedAt` on every set.
    const setOpportunity = async (
      exec: Executor,
      values: OpportunityUpdate,
    ) => {
      const [row] = await exec
        .update(opportunities)
        .set(values)
        .where(eq(opportunities.id, id))
        .returning({ id: opportunities.id });
      if (!row) {
        throw new UserSafeActionError("That opportunity no longer exists.");
      }
    };

    switch (parsedInput.field) {
      case "name":
        await setOpportunity(db, { name: parsedInput.name });
        break;
      case "companyId":
        await setOpportunity(db, { companyId: parsedInput.companyId });
        break;
      case "lineOfBusiness":
        await setOpportunity(db, {
          lineOfBusiness: parsedInput.lineOfBusiness,
        });
        break;
      case "status": {
        await assertOpportunityTransitionAllowed(id, parsedInput.status);
        const nextStatus = parsedInput.status;
        await db.transaction(async (tx) => {
          // Capture the prior status to detect a genuine move into `closed_won`.
          const [before] = await tx
            .select({ status: opportunities.status })
            .from(opportunities)
            .where(eq(opportunities.id, id))
            .limit(1);
          if (!before) {
            throw new UserSafeActionError("That opportunity no longer exists.");
          }
          await setOpportunity(tx, { status: nextStatus });
          // Won locks this opportunity's tentative roles (same transaction).
          await confirmRolesOnWon(tx, id, nextStatus, before.status);
        });
        break;
      }
      case "contacts":
        await db.transaction(async (tx) => {
          await setOpportunity(tx, { updatedAt: new Date() });
          await replaceOpportunityContacts(tx, id, parsedInput.contactIds);
        });
        break;
      case "owners":
        await db.transaction(async (tx) => {
          await setOpportunity(tx, { updatedAt: new Date() });
          await replaceOpportunityOwners(tx, id, parsedInput.ownerIds);
        });
        break;
      case "source":
        await db.transaction(async (tx) => {
          // Setting the source column both persists the change and guards the
          // row's existence for the junction rewrites below.
          await setOpportunity(tx, { source: parsedInput.source });
          await replaceOpportunitySourceStaff(
            tx,
            id,
            parsedInput.sourceStaffIds,
          );
          await replaceOpportunitySourceContacts(
            tx,
            id,
            parsedInput.sourceContactIds,
          );
        });
        break;
    }

    revalidatePath("/opportunities");
    return { id };
  });
