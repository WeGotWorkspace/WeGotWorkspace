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

let mockOperations: CalendarReplyMailboxOperations | null = null;

/** Live REST with an API; one in-memory mock per page otherwise. */
export function defaultCalendarReplyMailboxOperations(): CalendarReplyMailboxOperations {
  return createWorkspaceSource<CalendarReplyMailboxOperations>({
    isLive: wgwLiveApiEnabled(),
    createLiveSource: createWgwCalendarReplyMailboxOperations,
    createMockSource: () => (mockOperations ??= createMockCalendarReplyMailboxOperations()),
  });
}

export type CalendarReplyMailboxFormValues = {
  host: string;
  security: "ssl" | "starttls";
  /** Empty for the usual port of the security mode. */
  port: string;
  username: string;
  /** Empty keeps the saved password. */
  password: string;
  folder: string;
};

export const EMPTY_REPLY_MAILBOX_FORM: CalendarReplyMailboxFormValues = {
  host: "",
  security: "ssl",
  port: "",
  username: "",
  password: "",
  folder: "INBOX",
};

const USUAL_PORT = { ssl: 993, starttls: 143 } as const;

export function usualReplyMailboxPort(
  security: CalendarReplyMailboxFormValues["security"],
): number {
  return USUAL_PORT[security];
}

export function replyMailboxToForm(
  mailbox: CalendarReplyMailbox | null,
): CalendarReplyMailboxFormValues {
  if (!mailbox) return EMPTY_REPLY_MAILBOX_FORM;
  return {
    host: mailbox.host,
    security: mailbox.security,
    port: mailbox.port === USUAL_PORT[mailbox.security] ? "" : String(mailbox.port),
    username: mailbox.username,
    password: "",
    folder: mailbox.folder,
  };
}

/** `null` when a required field is empty (the password only on the first connect). */
export function replyMailboxUpdateFromForm(
  values: CalendarReplyMailboxFormValues,
  connected: boolean,
): CalendarReplyMailboxUpdate | null {
  const host = values.host.trim();
  const username = values.username.trim();
  if (!host || !username || (!connected && !values.password)) return null;
  const port = values.port.trim();
  return {
    host,
    security: values.security,
    ...(port ? { port: Number(port) } : {}),
    username,
    ...(values.password ? { password: values.password } : {}),
    folder: values.folder.trim() || "INBOX",
  };
}
