import type {
  CalendarReplyMailboxOperations,
  MailboxFolder,
} from "@/lib/api/wgw/calendar-reply-mailbox";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import type {
  CalendarReplyMailbox,
  CalendarReplyMailboxState,
} from "@wgw/openapi-types/calendars-types";

/** The mock's folders, as Mailbox/get would list them. */
export const MOCK_MAILBOX_FOLDERS: MailboxFolder[] = [
  { id: "M-inbox", label: "INBOX", role: "inbox" },
  { id: "M-archive", label: "Archive", role: "archive" },
  { id: "M-replies", label: "INBOX / Calendar replies", role: null },
];

const MOCK_FOLDER_NAMES: Record<string, string> = {
  "M-inbox": "INBOX",
  "M-archive": "Archive",
  "M-replies": "INBOX/Calendar replies",
};

function mockMailboxFolderId(folder: string): string {
  return (
    Object.entries(MOCK_FOLDER_NAMES).find(([, name]) => name === folder)?.[0] ??
    `M-${folder.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
  );
}

/** A connected mailbox as the server returns it after a successful save. */
export function mockCalendarReplyMailbox(
  overrides: Partial<CalendarReplyMailbox> = {},
): CalendarReplyMailbox {
  const trustedServer =
    "trustedServer" in overrides ? (overrides.trustedServer ?? null) : "mx.example.com";
  return {
    host: "imap.example.com",
    port: 993,
    security: "ssl",
    username: "me@example.com",
    folder: "INBOX",
    folderId: mockMailboxFolderId("INBOX"),
    passwordSet: true,
    trustedServer,
    // Like the server: DKIM is the check whenever no trusted receiving server is known.
    senderCheck: trustedServer ? "receiving_server" : "dkim",
    active: true,
    lastCheckedAt: "2026-11-13T09:40:00Z",
    lastSuccessAt: "2026-11-13T09:40:00Z",
    lastError: null,
    ...overrides,
  };
}

/**
 * In-memory stand-in for `/api/v1/calendars/reply-mailbox`, with the server's rules: the first
 * save needs a password, so does a new host or port, and the password `wrong` fails the login with 422 `auth_failed`.
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
      const port = update.port ?? (update.security === "ssl" ? 993 : 143);
      if (mailbox && !password && (update.host !== mailbox.host || port !== mailbox.port)) {
        throw new WgwRequestError("PUT /calendars/reply-mailbox failed (400)", 400, "bad_request");
      }
      if (password === "wrong") {
        throw new WgwRequestError("PUT /calendars/reply-mailbox failed (422)", 422, "auth_failed");
      }
      let folder = update.folder || "INBOX";
      if (update.folderId) {
        const named = MOCK_FOLDER_NAMES[update.folderId];
        if (!named) {
          throw new WgwRequestError(
            "PUT /calendars/reply-mailbox failed (422)",
            422,
            "folder_missing",
          );
        }
        folder = named;
      }
      mailbox = mockCalendarReplyMailbox({
        host: update.host,
        port,
        security: update.security,
        username: update.username,
        folder,
        folderId: mockMailboxFolderId(folder),
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
    folders: async () => (mailbox ? structuredClone(MOCK_MAILBOX_FOLDERS) : []),
  };
}
