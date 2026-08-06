import "server-only";

import { UserSafeActionError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { DriveApiError } from "./driveApi";

/**
 * Turn a failed `files.copy` into copy that names the actual obstacle.
 *
 * Shared by `copyDriveFile` (a Picker selection into a folder) and
 * `assignTranscript` (a transcript into `<record>/Transcripts`). One module rather
 * than two switches because the failures are the file's, not the flow's — a
 * `cannotCopyFile` means the same thing and needs the same words whichever button
 * was pressed, and `cannotCopyFile` is the likeliest real-world failure of either.
 */
export function copyFailureError(error: unknown): UserSafeActionError {
  if (!(error instanceof DriveApiError)) {
    return new UserSafeActionError("Couldn't copy that file into the folder.");
  }

  switch (error.code) {
    case "cannotCopyFile":
      // The owner set "viewers cannot copy" on the original. The most likely
      // real-world failure here, and one only they can undo — so say so rather
      // than leaving the user retrying.
      return new UserSafeActionError(
        "The owner of that file has disabled copying. Ask them to share it another way.",
      );
    case "insufficientFilePermissions":
    case "forbidden":
      return new UserSafeActionError(
        "You don't have permission to add files to this folder.",
      );
    case "storageQuotaExceeded":
      return new UserSafeActionError(
        "The shared drive is out of space. Ask an admin to free some up.",
      );
    case "rateLimitExceeded":
    case "userRateLimitExceeded":
      return new UserSafeActionError("Drive is busy — try again in a moment.");
    default:
      if (error.status === 401) {
        return new UserSafeActionError(
          "Reconnect your Google account to use Drive.",
        );
      }
      logger.warn("drive_file_copy_failed", {
        code: error.code,
        status: error.status,
      });
      return new UserSafeActionError(
        "Couldn't copy that file into the folder.",
      );
  }
}
