import { z } from "zod";
import { optionalUrl } from "@/lib/url-schema";

export const updateStaffLinksSchema = z.object({
  staffId: z.string().min(1),
  linkedinUrl: optionalUrl,
  githubUrl: optionalUrl,
  portfolioUrl: optionalUrl,
});

export type UpdateStaffLinksInput = z.input<typeof updateStaffLinksSchema>;
