import {
  employmentTypeEnum,
  lineOfBusinessEnum,
  roleEnum,
} from "@/lib/db/schema";

/**
 * The staff filter dimensions offered by the directory and the performance /
 * levels dashboards, sourced from the DB enums. Client-safe (no `server-only`,
 * no `db`): pages and UI read these option lists without importing the Drizzle
 * schema themselves (the actions layer owns all `@/lib/db` access). Single
 * source for the three shared dimensions; the directory layers `billableType`
 * on top of these.
 */
export const STAFF_FILTER_OPTIONS = {
  lineOfBusiness: [...lineOfBusinessEnum.enumValues],
  role: [...roleEnum.enumValues],
  employmentType: [...employmentTypeEnum.enumValues],
};
