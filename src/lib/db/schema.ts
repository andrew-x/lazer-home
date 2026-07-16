// Barrel for the full Drizzle schema — keep everything reachable from one
// import (`import * as schema from "@/lib/db/schema"`). One module per domain.

// Better Auth tables (user, session, account, verification).
export * from "./auth-schema";
// CRM domain (companies, contacts).
export * from "./crm-schema";
// CRM sales pipeline (opportunities + junction tables).
export * from "./opportunities-schema";
// Performance domain (peer feedback + rating enum).
export * from "./performance-schema";
// Projects domain (projects, delivery managers, roles).
export * from "./projects-schema";
// Survey responses domain (generic responses table).
export * from "./responses-schema";
// Staff profiles domain (staff, staff_employment, staff_pto + enums).
export * from "./staff-schema";
// Timesheets domain (timesheets, time_entries + enums).
export * from "./timesheets-schema";
