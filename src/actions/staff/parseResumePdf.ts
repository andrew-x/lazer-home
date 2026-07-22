"use server";

import { extractText, getDocumentProxy } from "unpdf";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { parseResumePdfSchema } from "./parseResumePdf.schema";

/**
 * Extract plain text from an uploaded PDF so the client can drop it into the
 * resume textarea for review. Does NOT touch the database — the user reviews
 * and then saves via `updateStaffResume`. `secureActionClient` requires a
 * valid session.
 */
export const parseResumePdf = secureActionClient
  .metadata({ action: "parse-resume-pdf" })
  .inputSchema(parseResumePdfSchema)
  .action(async ({ parsedInput }) => {
    let text: string;
    try {
      const bytes = new Uint8Array(
        Buffer.from(parsedInput.fileBase64, "base64"),
      );
      const pdf = await getDocumentProxy(bytes);
      ({ text } = await extractText(pdf, { mergePages: true }));
    } catch {
      throw new UserSafeActionError(
        "Couldn't read that PDF. Paste the text manually instead.",
      );
    }

    // Strip NUL bytes (U+0000) — PDF extraction can leave them embedded, and
    // Postgres `text` can't store them. fromCharCode keeps a literal NUL out of
    // source.
    const trimmed = text.split(String.fromCharCode(0)).join("").trim();
    if (!trimmed) {
      throw new UserSafeActionError(
        "That PDF had no extractable text (it may be scanned images). Paste the text manually instead.",
      );
    }

    return { text: trimmed };
  });
