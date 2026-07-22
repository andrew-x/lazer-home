/**
 * Shared limits for the resume PDF upload, so the client-side guard
 * (`edit-resume-dialog.tsx`) and the server-side schema backstop
 * (`parseResumePdf.schema.ts`) can't drift.
 *
 * The raw-byte ceiling is the single source of truth; the base64 ceiling is
 * derived from it. Base64 encodes every 3 raw bytes into a 4-char block (padded
 * up), so a file of `bytes` encodes to `ceil(bytes / 3) * 4` characters. Keeping
 * the payload under this sits below the configured server-action body limit.
 */
export const MAX_PDF_BYTES = 6 * 1024 * 1024;

/** The base64 character ceiling for a {@link MAX_PDF_BYTES} file (derived, not guessed). */
export const MAX_PDF_BASE64_CHARS = Math.ceil(MAX_PDF_BYTES / 3) * 4;

/** Shared user-facing message for both the client and server size checks. */
export const PDF_TOO_LARGE_MESSAGE =
  "That PDF is too large. Keep it under ~6 MB.";
