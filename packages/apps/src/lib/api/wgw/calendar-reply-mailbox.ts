import {
  parseApiErrorJson,
  wgwErrorMessageFromBody,
  wgwFetch,
  wgwReadJson,
} from "@/lib/api/wgw/http";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
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

export type CalendarReplyMailboxOperations = {
  load: () => Promise<CalendarReplyMailboxState>;
  save: (update: CalendarReplyMailboxUpdate) => Promise<CalendarReplyMailboxState>;
  test: () => Promise<CalendarReplyMailboxState>;
  disconnect: () => Promise<void>;
};

async function failure(res: Response, method: string, path: string): Promise<WgwRequestError> {
  const body = await res.text();
  const detail = wgwErrorMessageFromBody(body, res.status, res.statusText);
  const code = parseApiErrorJson(body.trim())?.code;
  return new WgwRequestError(
    `${method} ${path} failed (${res.status}): ${detail}`,
    res.status,
    typeof code === "string" ? code : undefined,
  );
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
  };
}
