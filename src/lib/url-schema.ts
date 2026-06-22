import { z } from "zod";

/**
 * Shared optional-URL field validator. Blank/whitespace → null; a bare host like
 * "acme.com" is normalised to "https://acme.com" before validating, so users
 * never have to type the scheme. Only http/https are accepted — other schemes
 * (ftp:, javascript:, etc.) are rejected, since these values get rendered as
 * clickable hrefs. Accepts null on input too, so re-parsing the transformed
 * value (client → server round-trip) is stable.
 *
 * Reused by every form with an optional URL (staff links, company website) so
 * the behaviour and messaging stay consistent in one place.
 */
export const optionalUrl = z
  .string()
  .nullish()
  .transform((value) => {
    const trimmed = (value ?? "").trim();
    if (trimmed === "") return null;
    return trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  })
  .pipe(
    z
      .url({ protocol: /^https?$/, error: "Enter a valid http(s) URL." })
      .nullable(),
  );
