import { z } from "zod";
import { optionalUrl } from "@/lib/url-schema";

export const createCompanySchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  websiteUrl: optionalUrl,
  isPartner: z.boolean().default(false),
});

export type CreateCompanyInput = z.input<typeof createCompanySchema>;
