import {
  isCollabPayloadTooLarge,
  isCollabPreconditionFailed,
} from "@/text-editor-core/docs-collab/docs-collab-utils";

export const NOTES_TOO_LARGE_MESSAGE = "This note is too large to save.";

export function isNotesPayloadTooLargeError(error: unknown): boolean {
  return isCollabPayloadTooLarge(error);
}

export function isNotesPreconditionFailedError(error: unknown): boolean {
  return isCollabPreconditionFailed(error);
}
