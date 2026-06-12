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
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:", parsed.error.issues);
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;
