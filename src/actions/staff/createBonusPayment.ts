"use server";

import { createBonusPaymentSchema } from "@/actions/staff/bonusPayment.schema";
import { revalidateBonusPayment } from "@/actions/staff/bonusPaymentMutation";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { staffBonusPayment } from "@/lib/db/schema";
import { BONUS_PAYMENT_WRITE_ACCESS } from "@/lib/staff/staff-bonus";

/**
 * Record a bonus payment against a staff member.
 *
 * Gated by `BONUS_PAYMENT_WRITE_ACCESS` (`staff.edit` AND
 * `staff.viewCompensation`) — enforced by `secureActionClient` before this body.
 * The capability is org-wide (a manager may record a bonus for anyone), so there
 * is no ownership dimension and no `authorize` hook is needed.
 *
 * `ripplingId` is left null: hand-entered rows must not squat on the unique key
 * the future Rippling importer needs to stay idempotent.
 */
export const createBonusPayment = secureActionClient
  .metadata({
    action: "create-bonus-payment",
    permission: BONUS_PAYMENT_WRITE_ACCESS,
  })
  .inputSchema(createBonusPaymentSchema)
  .action(async ({ parsedInput }) => {
    const [row] = await db
      .insert(staffBonusPayment)
      .values({
        id: generateId("sbp"),
        staffId: parsedInput.staffId,
        paymentDate: parsedInput.paymentDate,
        type: parsedInput.type,
        amount: parsedInput.amount,
        currency: parsedInput.currency,
        notes: parsedInput.notes,
      })
      .returning({ id: staffBonusPayment.id });

    revalidateBonusPayment(parsedInput.staffId);
    return { id: row.id };
  });
