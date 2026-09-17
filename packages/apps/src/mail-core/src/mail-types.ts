import type {
  WgwMailDraftRequest,
  WgwMailMessageDetail,
  WgwMailMessagePatchRequest,
  WgwMailSendRequest,
} from "@/lib/api/wgw/types";
import type { Mail, MailAttachment } from "@/types/mail";

export type MailboxSummary = {
  label: string;
  unreadCount?: number;
};

export type MailUIData = {
  /** UI-ready rows; per-message star state lives on `Mail.starred`. */
  mail: Mail[];
  /** All known mailboxes from folder data (system + custom), with optional unread counts. */
  mailboxes: MailboxSummary[];
};

export type MailMailboxLoader = {
  /** Fetch one mailbox page (offset/limit) from the API. */
  loadMailbox: (
    mailboxLabel: string,
    opts?: { offset?: number; limit?: number; query?: string },
  ) => Promise<{ rows: Mail[]; hasMore: boolean; nextOffset: number }>;
  /** Resolve opaque folder id for a sidebar label (for matching rows when labels differ from `m.mailbox`). */
  folderTokenForLabel?: (mailboxLabel: string) => string | undefined;
};

/**
 * Backend-agnostic mail operations consumed by the mail UI/controller.
 * Implement this contract for any provider (WGW, custom API, local-only, etc).
 */
export type MailAPIOperations = {
  patchMessage: (
    message: Mail,
    patch: Pick<WgwMailMessagePatchRequest, "read" | "starred">,
    opts?: { signal?: AbortSignal },
  ) => Promise<void>;
  moveMessages: (
    messages: Mail[],
    toMailboxLabel: string,
    opts?: { signal?: AbortSignal },
  ) => Promise<void>;
  deleteMessages: (
    messages: Pick<Mail, "folder" | "uid">[],
    opts?: { signal?: AbortSignal },
  ) => Promise<void>;
  createDraft: (input: WgwMailDraftRequest, opts?: { signal?: AbortSignal }) => Promise<void>;
  saveDraft: (input: WgwMailDraftRequest, opts?: { signal?: AbortSignal }) => Promise<void>;
  sendMessage: (input: WgwMailSendRequest, opts?: { signal?: AbortSignal }) => Promise<void>;
  fetchMessageDetail: (
    message: Pick<Mail, "id" | "folder" | "uid">,
  ) => Promise<WgwMailMessageDetail | null>;
  downloadAttachment: (
    message: Pick<Mail, "id" | "folder" | "uid">,
    attachment: MailAttachment,
    opts?: { signal?: AbortSignal },
  ) => Promise<Blob>;
};
