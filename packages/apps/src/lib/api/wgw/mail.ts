import type { WgwMailMessagePatchRequest, WgwMailMoveRequest } from "@/lib/api/wgw/types";
import type { Mail } from "@/types/mail";
export {
  coerceFolderNode,
  parseMailFoldersPayload,
  splitFoldersForUi,
  WGW_UI_SYSTEM_MAILBOXES,
} from "@/lib/api/wgw/mail-folder-utils";
export {
  coerceMailListRow,
  mailFromWgwDetail,
  mailFromWgwListItem,
  mailboxNameByFolderToken,
  parseMessagesPayload,
  resolveMailboxLabel,
} from "@/lib/api/wgw/mail-message-utils";
export {
  buildMailboxToFolderId,
  canonicalImapMailboxLabel,
  folderIdForMailboxLabel,
  folderLabelForMailbox,
  folderTokenCandidatesForMailbox,
} from "@/lib/api/wgw/mail-token-utils";

/**
 * Encode a mailbox display label to the opaque `folder` string used in
 * message rows (often base64). Live Mail I/O is JMAP (`mail-jmap.ts`).
 */
import { folderTokenFromMailboxLabel } from "@/lib/mail/folder-token";

export function wgwMailPatchRequest(
  mail: Mail,
  patch: Pick<WgwMailMessagePatchRequest, "read" | "starred">,
): WgwMailMessagePatchRequest {
  return {
    folder: mail.folder,
    uid: mail.uid,
    ...patch,
  };
}

export function wgwMailMoveRequest(mail: Mail, toFolderToken: string): WgwMailMoveRequest {
  return {
    fromFolder: mail.folder,
    toFolder: toFolderToken,
    uid: mail.uid,
  };
}

/** When no folder tree is available, derive the API token from the UI mailbox label. */
export function folderTokenForMail(mailboxLabel: string): string {
  return folderTokenFromMailboxLabel(mailboxLabel);
}
