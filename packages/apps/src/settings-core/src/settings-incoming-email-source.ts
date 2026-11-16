import { createWorkspaceSource } from "@/lib/api/create-workspace-source";
import { createMockCalendarReplyMailboxOperations } from "@/lib/api/mock/calendar-reply-mailbox";
import {
  createWgwCalendarReplyMailboxOperations,
  type CalendarReplyMailboxOperations,
} from "@/lib/api/wgw/calendar-reply-mailbox";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import type {
  CalendarReplyMailbox,
  CalendarReplyMailboxUpdate,
} from "@wgw/openapi-types/calendars-types";

/**
 * The user's incoming mailbox (Settings → Incoming email). Calendar invitation replies are its
 * first use, so the REST resource still lives under `/calendars/reply-mailbox`.
 */
export type IncomingMailbox = CalendarReplyMailbox;
export type IncomingMailboxOperations = CalendarReplyMailboxOperations;

let mockOperations: IncomingMailboxOperations | null = null;

/** Live REST with an API; one in-memory mock per page otherwise, shared by both panes. */
export function defaultIncomingMailboxOperations(): IncomingMailboxOperations {
  return createWorkspaceSource<IncomingMailboxOperations>({
    isLive: wgwLiveApiEnabled(),
    createLiveSource: createWgwCalendarReplyMailboxOperations,
    createMockSource: () => (mockOperations ??= createMockCalendarReplyMailboxOperations()),
  });
}

export type IncomingEmailFormValues = {
  host: string;
  security: "ssl" | "starttls";
  /** Empty for the usual port of the security mode. */
  port: string;
  username: string;
  /** Empty keeps the saved password. */
  password: string;
};

export const EMPTY_INCOMING_EMAIL_FORM: IncomingEmailFormValues = {
  host: "",
  security: "ssl",
  port: "",
  username: "",
  password: "",
};

export const DEFAULT_MAILBOX_FOLDER = "INBOX";

const USUAL_PORT = { ssl: 993, starttls: 143 } as const;

export function usualIncomingEmailPort(security: IncomingEmailFormValues["security"]): number {
  return USUAL_PORT[security];
}

export function incomingEmailToForm(mailbox: IncomingMailbox | null): IncomingEmailFormValues {
  if (!mailbox) return EMPTY_INCOMING_EMAIL_FORM;
  return {
    host: mailbox.host,
    security: mailbox.security,
    port: mailbox.port === USUAL_PORT[mailbox.security] ? "" : String(mailbox.port),
    username: mailbox.username,
    password: "",
  };
}

/**
 * The server sends the stored password only to the server it was saved for: a new mail server
 * or port needs the password typed again.
 */
export function incomingEmailNeedsPasswordAgain(
  values: IncomingEmailFormValues,
  saved: IncomingMailbox | null,
): boolean {
  if (!saved || values.password) return false;
  const port = values.port.trim()
    ? Number(values.port.trim())
    : usualIncomingEmailPort(values.security);
  return values.host.trim().toLowerCase() !== saved.host || port !== saved.port;
}

/**
 * `null` when a required field is empty (the password only on the first connect). The folder
 * is not part of the connection: the saved one is sent back unchanged.
 */
export function incomingEmailUpdateFromForm(
  values: IncomingEmailFormValues,
  saved: IncomingMailbox | null,
): CalendarReplyMailboxUpdate | null {
  const host = values.host.trim();
  const username = values.username.trim();
  if (!host || !username || (!saved && !values.password)) return null;
  const port = values.port.trim();
  return {
    host,
    security: values.security,
    ...(port ? { port: Number(port) } : {}),
    username,
    ...(values.password ? { password: values.password } : {}),
    folder: saved?.folder ?? DEFAULT_MAILBOX_FOLDER,
  };
}

/** The saved connection with another folder; the stored password is kept. */
export function mailboxFolderUpdate(
  saved: IncomingMailbox,
  folder: string,
): CalendarReplyMailboxUpdate {
  return {
    host: saved.host,
    security: saved.security,
    port: saved.port,
    username: saved.username,
    folder: folder.trim() || DEFAULT_MAILBOX_FOLDER,
  };
}
