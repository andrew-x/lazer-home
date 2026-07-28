// Server-only: the list page's delete confirm calls the action, and importing a
// `'use server'` action does NOT pull in its schema (ADR 0035). Kept hand-written
// zod anyway so it stays safe to import from a client component if that changes.
import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";

export const deleteCompensationPlanSchema = z.object({ planId: id });

export type DeleteCompensationPlanInput = z.infer<
  typeof deleteCompensationPlanSchema
>;
