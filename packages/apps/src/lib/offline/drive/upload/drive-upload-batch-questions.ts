import type { DriveUploadBatchConflicts } from "@/lib/offline/drive/upload/drive-upload-conflicts";
import type { DriveUploadFolderQuestion } from "@/lib/offline/drive/upload/drive-upload-folder-conflicts";
import type { DriveUploadKeepOfflineQuestion } from "@/lib/offline/drive/upload/drive-upload-keep-offline";
import type { DriveUploadSpaceCheck } from "@/lib/offline/drive/upload/drive-upload-schema";

/** A space pre-check with numbers (`fits` or `does_not_fit`). */
export type DriveUploadKnownSpaceCheck = Exclude<DriveUploadSpaceCheck, { status: "unknown" }>;

/**
 * What the batch dialog (#1521) asks before a batch uploads. Each part is
 * null when its step does not apply; all null means no dialog.
 */
export type DriveUploadBatchQuestions = {
  /** The space pre-check said the batch will not fit. */
  space: DriveUploadKnownSpaceCheck | null;
  conflicts: DriveUploadBatchConflicts | null;
  keepOffline: DriveUploadKeepOfflineQuestion | null;
  /** A folder upload whose top-level folder name is taken (#1620). */
  folders?: DriveUploadFolderQuestion | null;
};

export function hasDriveUploadBatchQuestions(questions: DriveUploadBatchQuestions): boolean {
  return Boolean(
    questions.space || questions.conflicts || questions.keepOffline || questions.folders,
  );
}
