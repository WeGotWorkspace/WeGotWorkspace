import type { Note } from "@/lib/models/note";

export type MailAttachment = {
  id?: string;
  name: string;
  size?: number;
  type?: string;
  /** MIME part identifier used for attachment download requests. */
  part?: string;
};

export type Mail = Note & {
  title: string;
  from: string;
  email: string;
  mailbox: string;
  unread: boolean;
  /** Opaque folder id for `MailMessagePatchRequest.folder` / `MailMoveRequest`. */
  folder: string;
  /** IMAP UID for patch/move/delete operations. */
  uid: number;
  /** Optional full HTML body from detail endpoints. */
  bodyHtml?: string;
  /** True once message detail payload has been loaded. */
  detailLoaded?: boolean;
  /** Attachment metadata, populated from message detail payloads. */
  attachments?: MailAttachment[];
  threadId?: string;
  mailboxIds?: Record<string, boolean>;
};
