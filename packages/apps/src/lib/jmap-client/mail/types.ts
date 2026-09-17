import type { JmapId } from "../core/types.js";

export type JmapEmailAddress = {
  name?: string | null;
  email: string;
};

export type JmapEmailBodyPart = {
  partId?: string;
  blobId?: string;
  type?: string;
  name?: string | null;
  size?: number;
  disposition?: string | null;
};

export type JmapEmailBodyValue = {
  value: string;
  isEncodingProblem?: boolean;
  isTruncated?: boolean;
};

export type JmapMailboxRights = {
  mayReadItems: boolean;
  mayAddItems: boolean;
  mayRemoveItems: boolean;
  maySetSeen: boolean;
  maySetKeywords: boolean;
  mayCreateChild: boolean;
  mayRename: boolean;
  mayDelete: boolean;
  maySubmit: boolean;
};

export type JmapMailbox = {
  id: JmapId;
  name: string;
  parentId?: JmapId | null;
  role?: string | null;
  sortOrder?: number;
  totalEmails?: number;
  unreadEmails?: number;
  totalThreads?: number;
  unreadThreads?: number;
  myRights?: JmapMailboxRights;
  isSubscribed?: boolean;
  [key: string]: unknown;
};

export type JmapEmail = {
  id: JmapId;
  blobId?: string;
  threadId?: JmapId;
  mailboxIds?: Record<JmapId, boolean>;
  keywords?: Record<string, boolean>;
  size?: number;
  receivedAt?: string;
  sentAt?: string;
  subject?: string;
  preview?: string;
  hasAttachment?: boolean;
  from?: JmapEmailAddress[];
  to?: JmapEmailAddress[];
  cc?: JmapEmailAddress[];
  bcc?: JmapEmailAddress[];
  messageId?: string[];
  inReplyTo?: string[];
  textBody?: JmapEmailBodyPart[];
  htmlBody?: JmapEmailBodyPart[];
  attachments?: JmapEmailBodyPart[];
  bodyValues?: Record<string, JmapEmailBodyValue>;
  [key: string]: unknown;
};

export type JmapThread = {
  id: JmapId;
  emailIds: JmapId[];
};

export type JmapIdentity = {
  id: JmapId;
  name: string;
  email: string;
  mayDelete?: boolean;
};

export type JmapEmailSubmission = {
  id: JmapId;
  identityId: JmapId;
  emailId: JmapId;
  threadId?: JmapId;
  envelope?: {
    mailFrom?: { email: string };
    rcptTo?: Array<{ email: string }>;
  };
};

export type JmapEmailFilterCondition = {
  inMailbox?: JmapId;
  text?: string;
  from?: string;
  to?: string;
  subject?: string;
  hasKeyword?: string;
  notKeyword?: string;
  after?: string;
  before?: string;
};
