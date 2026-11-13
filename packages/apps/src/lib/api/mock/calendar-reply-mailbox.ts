import type { CalendarReplyMailboxOperations } from "@/lib/api/wgw/calendar-reply-mailbox";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import type {
  CalendarReplyMailbox,
  CalendarReplyMailboxState,
} from "@wgw/openapi-types/calendars-types";

/** A connected mailbox as the server returns it after a successful save. */
export function mockCalendarReplyMailbox(
  overrides: Partial<CalendarReplyMailbox> = {},
): CalendarReplyMailbox {
  return {
    host: "imap.example.com",
    port: 993,
    security: "ssl",
    username: "me@example.com",
    folder: "INBOX",
    passwordSet: true,
    trustedServer: "mx.example.com",
    active: true,
    lastCheckedAt: "2026-11-13T09:40:00Z",
    lastSuccessAt: "2026-11-13T09:40:00Z",
    lastError: null,
    ...overrides,
  };
}

/**
 * In-memory stand-in for `/api/v1/calendars/reply-mailbox`, with the server's rules: the first
 * save needs a password, and the password `wrong` fails the login with 422 `auth_failed`.
 */
export function createMockCalendarReplyMailboxOperations(
  seed: CalendarReplyMailbox | null = null,
): CalendarReplyMailboxOperations {
  let mailbox = seed ? structuredClone(seed) : null;
  const state = (): CalendarReplyMailboxState => ({ mailbox: structuredClone(mailbox) });
  const checkedNow = () => {
    const now = new Date().toISOString();
    return { lastCheckedAt: now, lastSuccessAt: now, lastError: null, active: true };
  };
  return {
    load: async () => state(),
    save: async (update) => {
      const password = update.password ?? null;
      if (!mailbox && !password) {
        throw new WgwRequestError("PUT /calendars/reply-mailbox failed (400)", 400, "bad_request");
      }
      if (password === "wrong") {
        throw new WgwRequestError("PUT /calendars/reply-mailbox failed (422)", 422, "auth_failed");
      }
      mailbox = mockCalendarReplyMailbox({
        host: update.host,
        port: update.port ?? (update.security === "ssl" ? 993 : 143),
        security: update.security,
        username: update.username,
        folder: update.folder || "INBOX",
        ...checkedNow(),
      });
      return state();
    },
    test: async () => {
      if (!mailbox) {
        throw new WgwRequestError("POST /calendars/reply-mailbox/test failed (404)", 404);
      }
      mailbox = { ...mailbox, ...checkedNow() };
      return state();
    },
    disconnect: async () => {
      mailbox = null;
    },
  };
}
