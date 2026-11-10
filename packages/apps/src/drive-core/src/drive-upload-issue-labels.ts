import type { DriveUploadErrorCode } from "@/lib/offline/drive/upload/drive-upload-schema";
import { workspaceLabels } from "@/lib/workspace/workspace-labels";

/** Copy of the upload pause and error states (#1522). */
export const driveUploadIssueLabels = {
  serverFullTitle: "Uploads are paused: the server is full",
  serverFullMessage:
    "No other file starts until there is space. Files in the trash still take up space, so emptying the trash helps.",
  serverFullRetry: workspaceLabels.dialog.retry,
  /** Accessible text of the Uploads sidebar badge while the queue is paused. */
  badgePaused: "paused, the server is full",

  chooseFolder: "Choose another folder",
  chooseFolderTitle: (name: string) => `Choose a folder for ${name}`,
  chooseFolderDescription: "The file uploads to the folder you choose.",
  chooseFolderConfirm: "Upload here",
  chooseFolderDone: (name: string, folder: string) => `${name} will upload to ${folder}`,

  /** Admin link on an `insecure_context` file, only for administrators. */
  openAdmin: "Open Admin",
} as const;

/** What the user can do about a failed file, shown under its status. */
const REASON_DETAIL: Partial<Record<DriveUploadErrorCode, string>> = {
  target_missing: "Choose another folder for it, or remove it.",
  forbidden:
    "Ask the owner to share the folder with you again, or choose another folder for this file.",
  insecure_context:
    "This server is not on https, so large files cannot be uploaded. Ask your administrator to set up https.",
  auth: "Retry takes you to sign in, then the upload goes on.",
};

export function driveUploadReasonDetail(reason: DriveUploadErrorCode | undefined): string | null {
  return reason ? (REASON_DETAIL[reason] ?? null) : null;
}

/** Failed files that can go to another folder instead of the one they had. */
const CHOOSE_FOLDER_REASONS = new Set<DriveUploadErrorCode>(["target_missing", "forbidden"]);

export function canChooseDriveUploadFolder(reason: DriveUploadErrorCode | undefined): boolean {
  return reason ? CHOOSE_FOLDER_REASONS.has(reason) : false;
}
