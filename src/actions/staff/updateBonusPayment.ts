"use server";

import { eq } from "drizzle-orm";
import { updateBonusPaymentSchema } from "@/actions/staff/bonusPayment.schema";
import {
  assertBonusPaymentTouched,
  revalidateBonusPayment,
} from "@/actions/staff/bonusPaymentMutation";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { staffBonusPayment } from "@/lib/db/schema";
import { BONUS_PAYMENT_WRITE_ACCESS } from "@/lib/staff/staff-bonus";

/**
 * Correct a recorded bonus payment.
 *
 * Gated by `BONUS_PAYMENT_WRITE_ACCESS` — see `createBonusPayment` for why a
 * static capability gate is sufficient here.
 *
 * `staffId` is not updatable: a payment recorded against the wrong person is
 * deleted and re-entered, so money never silently moves between people's records.
 * The owning staff id is read back from the row for revalidation rather than
 * trusted from the client.
 */
export const updateBonusPayment = secureActionClient
  .metadata({
    action: "update-bonus-payment",
    permission: BONUS_PAYMENT_WRITE_ACCESS,
  })
  .inputSchema(updateBonusPaymentSchema)
  .action(async ({ parsedInput }) => {
    const rows = await db
      .update(staffBonusPayment)
      .set({
        paymentDate: parsedInput.paymentDate,
        type: parsedInput.type,
        amount: parsedInput.amount,
        currency: parsedInput.currency,
        notes: parsedInput.notes,
      })
      .where(eq(staffBonusPayment.id, parsedInput.paymentId))
      .returning({ staffId: staffBonusPayment.staffId });

    revalidateBonusPayment(assertBonusPaymentTouched(rows));
    return { id: parsedInput.paymentId };
  });
