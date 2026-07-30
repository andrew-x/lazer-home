"use server";

import { eq } from "drizzle-orm";
import { deleteBonusPaymentSchema } from "@/actions/staff/bonusPayment.schema";
import {
  assertBonusPaymentTouched,
  revalidateBonusPayment,
} from "@/actions/staff/bonusPaymentMutation";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { staffBonusPayment } from "@/lib/db/schema";
import { BONUS_PAYMENT_WRITE_ACCESS } from "@/lib/staff/staff-bonus";

/**
 * Remove a bonus payment.
 *
 * A hard delete, unlike a review note's lifecycle: a payment recorded in error is
 * not history worth keeping, and leaving it soft-deleted would mean every total on
 * the dashboard had to remember to filter it out.
 *
 * Gated by `BONUS_PAYMENT_WRITE_ACCESS` — see `createBonusPayment`.
 */
export const deleteBonusPayment = secureActionClient
  .metadata({
    action: "delete-bonus-payment",
    permission: BONUS_PAYMENT_WRITE_ACCESS,
  })
  .inputSchema(deleteBonusPaymentSchema)
  .action(async ({ parsedInput }) => {
    const rows = await db
      .delete(staffBonusPayment)
      .where(eq(staffBonusPayment.id, parsedInput.paymentId))
      .returning({ staffId: staffBonusPayment.staffId });

    revalidateBonusPayment(assertBonusPaymentTouched(rows));
    return { id: parsedInput.paymentId };
  });
