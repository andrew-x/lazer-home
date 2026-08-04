/**
 * The one spelling of the Google Drive OAuth scope.
 *
 * Its own tiny pure module because three places need it and they sit on opposite
 * sides of the client/server line: the Better Auth config requests it at sign-in
 * (`src/lib/auth/auth.ts`), the token accessor checks a grant actually carries it
 * (`src/actions/drive/driveToken.ts`, server-only), and the reconnect button asks
 * for it incrementally (`drive-reconnect-button.tsx`, a Client Component). A
 * typo in any one of them fails silently — the login succeeds, and Drive simply
 * never works — so the string lives once.
 *
 * This is the FULL Drive scope, deliberately. The narrower `drive.file` grants
 * per-file access only, which would make a folder listing structurally incomplete:
 * a file a colleague added through Drive's own UI would be invisible to us. See
 * docs/decisions/0069 for that trade and for the privacy guarantees that replace
 * what the narrower scope would have enforced.
 */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
