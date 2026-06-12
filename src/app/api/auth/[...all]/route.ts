import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

// Single catch-all route mounts the entire Better Auth API.
export const { GET, POST } = toNextJsHandler(auth);
