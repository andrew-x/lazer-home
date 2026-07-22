import { z } from "zod";
import {
  MAX_PDF_BASE64_CHARS,
  PDF_TOO_LARGE_MESSAGE,
} from "@/lib/staff/pdf-upload";

/**
 * A PDF to extract resume text from. `fileBase64` is the raw PDF bytes,
 * base64-encoded with no `data:` prefix. The size ceiling is derived from the
 * shared raw-byte limit (`@/lib/staff/pdf-upload`) so it can't drift from the client's
 * own check; reject anything larger server-side as a backstop.
 */
export const parseResumePdfSchema = z.object({
  fileBase64: z
    .string()
    .min(1, "No file provided.")
    .max(MAX_PDF_BASE64_CHARS, PDF_TOO_LARGE_MESSAGE),
});
