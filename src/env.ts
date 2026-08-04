import { z } from "zod";

/**
 * Server-side environment variables, validated once at import.
 *
 * Server-only by convention — do NOT import this from a Client Component.
 * Client code should read `process.env.NEXT_PUBLIC_*` directly.
 * (We deliberately avoid `import "server-only"` here so drizzle-kit and the
 * better-auth CLI, which run in plain Node, can import the module chain.)
 */
// Treat blank entries ("FOO=") as unset rather than a zero-length string.
const optionalString = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().min(1).optional(),
);

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  BETTER_AUTH_SECRET: z.string().min(1, "BETTER_AUTH_SECRET is required"),
  BETTER_AUTH_URL: optionalString,
  // Optional: setting both turns on Google sign-in (see src/lib/auth.ts).
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  // Optional: setting this turns on the Slack channel integration (see
  // src/actions/slack/). A BOT token — refined rather than left as a bare
  // string so the classic "pasted a user token" mistake fails at boot here
  // instead of as an opaque `missing_scope` on the first channel create.
  SLACK_BOT_TOKEN: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .min(1)
      .refine(
        (v) => v.startsWith("xoxb-"),
        "SLACK_BOT_TOKEN must be a bot token (starts with 'xoxb-')",
      )
      .optional(),
  ),
  // Optional companion: scopes Slack deep links to one workspace, so someone
  // signed into several doesn't land in the wrong one. Links work without it.
  SLACK_TEAM_ID: optionalString,
  // Optional: setting ALL THREE turns on the Google Drive folder integration
  // (see src/actions/drive/). All three together, deliberately — browsing needs
  // only the drive id, but the Picker needs its own two, and a half-configured
  // install where files list but nothing can be added is worse than an off
  // feature. `isDriveConfigured()` is the single check.
  //
  // The id of the "Lazer Home" SHARED DRIVE — the root every folder lives under
  // and, via `driveList`, the hard boundary on what the app can ever enumerate.
  GOOGLE_DRIVE_ROOT_ID: optionalString,
  // Picker credentials. Both are NEXT_PUBLIC because the Picker runs in the
  // browser: neither is a secret (the API key should be restricted to the
  // Picker API in the Cloud console, and the app id is just the project
  // number). Read from `process.env` directly in client code, not from here.
  NEXT_PUBLIC_GOOGLE_PICKER_API_KEY: optionalString,
  NEXT_PUBLIC_GOOGLE_PICKER_APP_ID: optionalString,
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:", parsed.error.issues);
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;
