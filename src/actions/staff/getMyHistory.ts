import "server-only";

import { getCurrentStaffId } from "./getCurrentStaffId";
import {
  getStaffHistory,
  type HistoryCategory,
  type HistoryEntry,
} from "./getStaffHistory";

export type { HistoryCategory, HistoryEntry };

/** The signed-in user's own history feed, newest first. Delegates by staff id. */
export async function getMyHistory(): Promise<HistoryEntry[]> {
  const staffId = await getCurrentStaffId();
  return staffId ? getStaffHistory(staffId) : [];
}
