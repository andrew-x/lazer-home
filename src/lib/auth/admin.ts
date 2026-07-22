import "server-only";
import { headers } from "next/headers";
import { UserSafeActionError } from "@/lib/core/errors";

/**
 * The admin area is a local-only tooling surface (data seeding/maintenance).
 * It is gated on the request reaching the server over a loopback host — i.e.
 * the app is being run on the developer's machine, not a real deployment.
 *
 * This is the security boundary for the whole `/admin` segment and its actions,
 * so it is enforced server-side (host header), never trusted from the client.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** True when the app is running locally and the request came over loopback. */
export async function isLocalhost(): Promise<boolean> {
  // The Host header is caller-controlled and therefore spoofable, so it can
  // never be the only gate: a production deployment must refuse admin outright,
  // regardless of headers. NODE_ENV is the unspoofable lock; the loopback host
  // check below is defense-in-depth (e.g. a dev server bound to a LAN address).
  if (process.env.NODE_ENV === "production") return false;
  const headerList = await headers();
  const host = headerList.get("host") ?? "";
  // Strip the port (e.g. "localhost:3000" -> "localhost").
  const hostname = host.replace(/:\d+$/, "").toLowerCase();
  return LOOPBACK_HOSTS.has(hostname);
}

/**
 * Throws a user-safe error unless the request is local. Use inside admin
 * server actions; pages use `isLocalhost()` + `notFound()` instead.
 */
export async function assertLocalhost(): Promise<void> {
  if (!(await isLocalhost())) {
    throw new UserSafeActionError("Admin actions are only available locally.");
  }
}
