import "server-only";

import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { DRIVE_FOLDER_KINDS, type DriveFolderKind } from "@/lib/drive/folder";
import { DRIVE_FOLDER_TARGETS } from "./driveFolderLink";

/**
 * Which record kinds this viewer may file a transcript to.
 *
 * Resolved from the **same** `DRIVE_FOLDER_TARGETS` entries `authorizeDriveFolder`
 * gates `assignTranscript` with, so the UI cannot offer a kind the action would then
 * refuse — the divergence that a hand-written `user.role === "sales"` check here
 * would eventually introduce.
 *
 * Returns `[]` for an ordinary `user`, who holds neither `crm.edit` nor
 * `projects.edit`. That is the deliberate consequence recorded in ADR 0072: they see
 * their own transcripts and can dismiss them, but filing is an edit to the record.
 * The Triage widget is still worth rendering for them — dismissal is theirs, and the
 * list itself answers "did that call get recorded?".
 *
 * A read of the session and the permission matrix only, so it costs no query.
 */
export async function getAssignableTranscriptKinds(): Promise<
  DriveFolderKind[]
> {
  const user = await getCurrentUser();
  if (!user) return [];

  return DRIVE_FOLDER_KINDS.filter((kind) =>
    userHasPermission(user, DRIVE_FOLDER_TARGETS[kind].permission),
  );
}
