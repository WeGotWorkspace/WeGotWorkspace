import {
  parseApiErrorJson,
  wgwErrorMessageFromBody,
  wgwFetch,
  wgwReadJson,
} from "@/lib/api/wgw/http";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import { toApiRelativePath } from "@/lib/api/wgw/drive-jmap";
import { JmapClient } from "@/lib/jmap-client/core/JmapClient";
import { JmapMethodError } from "@/lib/jmap-client/core/errors";
import { JmapMailClient, type JmapMailbox } from "@/lib/jmap-client/mail/JmapMailClient";
import type {
  CalendarReplyMailboxState,
  CalendarReplyMailboxUpdate,
} from "@wgw/openapi-types/calendars-types";

/**
 * The IMAP mailbox the owner's invitation replies are read from (#1589). One REST resource, read
 * fresh when the settings pane opens. Saving and testing log in to the mailbox, so the server
 * answers 422 with a `code` when that fails. Errors carry the HTTP status and the code.
 */
const PATH = "/calendars/reply-mailbox";

/** One folder to pick, from JMAP Mailbox/get: its path reads "Parent / Child". */
export type MailboxFolder = { id: string; label: string; role: string | null };

export type CalendarReplyMailboxOperations = {
  load: () => Promise<CalendarReplyMailboxState>;
  save: (update: CalendarReplyMailboxUpdate) => Promise<CalendarReplyMailboxState>;
  test: () => Promise<CalendarReplyMailboxState>;
  disconnect: () => Promise<void>;
  /** The connected mailbox's folders, INBOX first. One login, counted like a test. */
  folders: () => Promise<MailboxFolder[]>;
};

/**
 * The server allows a few mailbox logins per window (connect, save, check). A 429 says when
 * the next one may run (`Retry-After`, seconds), so the client can wait instead of failing.
 */
export class MailboxLoginsLimitedError extends WgwRequestError {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number, code?: string) {
    super(message, 429, code);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const DEFAULT_RETRY_AFTER_SECONDS = 60;

async function failure(res: Response, method: string, path: string): Promise<WgwRequestError> {
  const body = await res.text();
  const detail = wgwErrorMessageFromBody(body, res.status, res.statusText);
  const code = parseApiErrorJson(body.trim())?.code;
  const message = `${method} ${path} failed (${res.status}): ${detail}`;
  const parsedCode = typeof code === "string" ? code : undefined;
  if (res.status === 429) {
    const seconds = Number(res.headers.get("Retry-After"));
    return new MailboxLoginsLimitedError(
      message,
      Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_RETRY_AFTER_SECONDS,
      parsedCode,
    );
  }
  return new WgwRequestError(message, res.status, parsedCode);
}

async function readState(
  res: Response,
  method: string,
  path = PATH,
): Promise<CalendarReplyMailboxState> {
  if (!res.ok) throw await failure(res, method, path);
  return (await wgwReadJson(res)) as CalendarReplyMailboxState;
}

export function createWgwCalendarReplyMailboxOperations(): CalendarReplyMailboxOperations {
  return {
    load: async () => readState(await wgwFetch(PATH), "GET"),
    save: async (update) =>
      readState(
        await wgwFetch(PATH, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update),
        }),
        "PUT",
      ),
    test: async () =>
      readState(await wgwFetch(`${PATH}/test`, { method: "POST" }), "POST", `${PATH}/test`),
    disconnect: async () => {
      const res = await wgwFetch(PATH, { method: "DELETE" });
      if (!res.ok) throw await failure(res, "DELETE", PATH);
    },
    folders: async () => {
      const mail = new JmapMailClient(createMailJmapClient());
      if (!mail.client.isConnected) await mail.client.connect();
      if (!mail.isSupported()) return [];
      try {
        const { list } = await mail.getMailboxes(["name", "parentId", "role"]);
        return mailboxFolders(list);
      } catch (error) {
        throw mailboxMethodFailure(error);
      }
    },
  };
}

function createMailJmapClient(): JmapClient {
  return new JmapClient({
    sessionUrl: "/jmap/session",
    fetch: (input, init) => wgwFetch(toApiRelativePath(input), init ?? {}),
  });
}

/** Mailbox/get errors as the REST errors the panes already explain. */
function mailboxMethodFailure(error: unknown): unknown {
  if (!(error instanceof JmapMethodError)) return error;
  const { args } = error;
  if (args.type === "serverUnavailable" && typeof args.retryAfter === "number") {
    return new MailboxLoginsLimitedError(error.message, args.retryAfter, "rate_limited");
  }
  return new WgwRequestError(
    error.message,
    422,
    typeof args.code === "string" ? args.code : undefined,
  );
}

/** Mailboxes as pickable folders: full path as the label, INBOX first, then by path. */
export function mailboxFolders(list: JmapMailbox[]): MailboxFolder[] {
  const byId = new Map(list.map((mailbox) => [mailbox.id, mailbox]));
  const path = (mailbox: JmapMailbox, seen = new Set<string>()): string => {
    const parent = mailbox.parentId ? byId.get(mailbox.parentId) : undefined;
    if (!parent || seen.has(parent.id)) return mailbox.name ?? mailbox.id;
    seen.add(mailbox.id);
    return `${path(parent, seen)} / ${mailbox.name ?? mailbox.id}`;
  };
  const folders = list.map((mailbox) => ({
    id: mailbox.id,
    label: path(mailbox),
    role: mailbox.role ?? null,
  }));
  return folders.sort((a, b) =>
    a.role === "inbox" ? -1 : b.role === "inbox" ? 1 : a.label.localeCompare(b.label),
  );
}
