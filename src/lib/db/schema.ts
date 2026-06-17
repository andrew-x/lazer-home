// Barrel for the full Drizzle schema — keep everything reachable from one
// import (`import * as schema from "@/lib/db/schema"`). One module per domain.

// Better Auth tables (user, session, account, verification).
export * from "./auth-schema";

// Staff profiles domain (staff, staff_employment, staff_pto + enums).
export * from "./staff-schema";
