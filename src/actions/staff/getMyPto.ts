import "server-only";

import { getCurrentStaffId } from "./getCurrentStaffId";
import {
  getStaffPto,
  type PtoCategorySummary,
  type PtoSpan,
  type PtoType,
  type StaffPtoView,
} from "./getStaffPto";

export type { PtoCategorySummary, PtoSpan, PtoType };
/** Back-compat alias — the PTO view shape is identical for self and others. */
export type MyPto = StaffPtoView;

/** The signed-in user's own time off. Delegates by staff id. */
export async function getMyPto(): Promise<MyPto> {
  const staffId = await getCurrentStaffId();
  if (!staffId) return { upcoming: [], past: [], summary: [] };
  return getStaffPto(staffId);
}
