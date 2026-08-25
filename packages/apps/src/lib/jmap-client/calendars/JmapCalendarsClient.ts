import { JmapSetItemError } from "../core/errors.js";
import type { JmapClient } from "../core/JmapClient.js";
import type {
  ChangesResponse,
  GetResponse,
  JmapId,
  JmapState,
  QueryChangesArgs,
  QueryChangesResponse,
  QueryResponse,
  SetArgs,
  SetResponse,
} from "../core/types.js";
import type { JmapCalendar, JmapCalendarEvent, JmapCalendarEventFilterCondition } from "./types.js";

const CALENDAR_TYPE = "Calendar";
const CALENDAR_EVENT_TYPE = "CalendarEvent";

export type DateRange = {
  /** Inclusive lower bound (UTC). */
  utcStart: Date;
  /** Exclusive upper bound (UTC). */
  utcEnd: Date;
};

function toUTCDateTime(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Throws {@link JmapSetItemError} for the first rejected record in a /set response. */
function assertSetSucceeded<T>(response: SetResponse<T>): void {
  const notCreated = Object.entries(response.notCreated ?? {});
  if (notCreated.length) throw new JmapSetItemError("create", notCreated[0][0], notCreated[0][1]);
  const notUpdated = Object.entries(response.notUpdated ?? {});
  if (notUpdated.length) throw new JmapSetItemError("update", notUpdated[0][0], notUpdated[0][1]);
  const notDestroyed = Object.entries(response.notDestroyed ?? {});
  if (notDestroyed.length)
    throw new JmapSetItemError("destroy", notDestroyed[0][0], notDestroyed[0][1]);
}

/**
 * Typed Calendar/CalendarEvent methods from the JMAP calendars draft, layered over a
 * {@link JmapClient}. Every method records the returned datatype state on the client so
 * `/changes` can resume from the latest known state.
 */
export class JmapCalendarsClient {
  readonly client: JmapClient;

  constructor(client: JmapClient) {
    this.client = client;
  }

  // ---- Calendar ----

  async getCalendars(accountId: JmapId, ids?: JmapId[] | null): Promise<GetResponse<JmapCalendar>> {
    const response = await this.client.call<GetResponse<JmapCalendar>>("Calendar/get", {
      accountId,
      ids: ids ?? null,
    });
    this.client.setState(accountId, CALENDAR_TYPE, response.state);
    return response;
  }

  async calendarChanges(accountId: JmapId, sinceState: JmapState, maxChanges?: number) {
    const response = await this.client.call<ChangesResponse>("Calendar/changes", {
      accountId,
      sinceState,
      ...(maxChanges !== undefined ? { maxChanges } : {}),
    });
    this.client.setState(accountId, CALENDAR_TYPE, response.newState);
    return response;
  }

  async setCalendars(
    args: Omit<SetArgs<JmapCalendar>, "accountId"> & {
      accountId: JmapId;
      /** draft-ietf-jmap-calendars: destroy events with the collection. */
      onDestroyRemoveEvents?: boolean;
    },
  ): Promise<SetResponse<JmapCalendar>> {
    const response = await this.client.call<SetResponse<JmapCalendar>>("Calendar/set", args);
    this.client.setState(args.accountId, CALENDAR_TYPE, response.newState);
    assertSetSucceeded(response);
    return response;
  }

  // ---- CalendarEvent ----

  async getCalendarEvents(
    accountId: JmapId,
    ids?: JmapId[] | null,
    properties?: string[] | null,
  ): Promise<GetResponse<JmapCalendarEvent>> {
    const response = await this.client.call<GetResponse<JmapCalendarEvent>>("CalendarEvent/get", {
      accountId,
      ids: ids ?? null,
      ...(properties !== undefined ? { properties } : {}),
    });
    this.client.setState(accountId, CALENDAR_EVENT_TYPE, response.state);
    return response;
  }

  async calendarEventChanges(accountId: JmapId, sinceState: JmapState, maxChanges?: number) {
    const response = await this.client.call<ChangesResponse>("CalendarEvent/changes", {
      accountId,
      sinceState,
      ...(maxChanges !== undefined ? { maxChanges } : {}),
    });
    this.client.setState(accountId, CALENDAR_EVENT_TYPE, response.newState);
    return response;
  }

  async setCalendarEvents(
    args: Omit<SetArgs<Omit<JmapCalendarEvent, "id">>, "accountId"> & { accountId: JmapId },
  ): Promise<SetResponse<JmapCalendarEvent>> {
    const response = await this.client.call<SetResponse<JmapCalendarEvent>>(
      "CalendarEvent/set",
      args,
    );
    this.client.setState(args.accountId, CALENDAR_EVENT_TYPE, response.newState);
    assertSetSucceeded(response);
    return response;
  }

  async queryCalendarEvents(
    accountId: JmapId,
    filter?: JmapCalendarEventFilterCondition | null,
    options: { position?: number; limit?: number; calculateTotal?: boolean } = {},
  ): Promise<QueryResponse> {
    return this.client.call<QueryResponse>("CalendarEvent/query", {
      accountId,
      filter: filter ?? null,
      ...options,
    });
  }

  async queryChangesCalendarEvents(
    args: Omit<QueryChangesArgs, "accountId"> & { accountId: JmapId },
  ): Promise<QueryChangesResponse> {
    return this.client.call<QueryChangesResponse>("CalendarEvent/queryChanges", args);
  }

  /**
   * Windowed fetch for a visible date range: `CalendarEvent/query` with an after/before
   * filter, back-referenced into `CalendarEvent/get` in the same request (one round trip).
   */
  async getCalendarEventsInRange(
    accountId: JmapId,
    range: DateRange,
    options: { inCalendars?: JmapId[] | null } = {},
  ): Promise<GetResponse<JmapCalendarEvent>> {
    const queryCallId = this.client.nextCallId();
    const getCallId = this.client.nextCallId();
    const filter: JmapCalendarEventFilterCondition = {
      after: toUTCDateTime(range.utcStart),
      before: toUTCDateTime(range.utcEnd),
      ...(options.inCalendars !== undefined ? { inCalendars: options.inCalendars } : {}),
    };
    const response = await this.client.request([
      ["CalendarEvent/query", { accountId, filter }, queryCallId],
      [
        "CalendarEvent/get",
        {
          accountId,
          "#ids": {
            resultOf: queryCallId,
            name: "CalendarEvent/query",
            path: "/ids",
          },
        },
        getCallId,
      ],
    ]);
    const getInvocation = response.methodResponses.find(
      ([name, , id]) => id === getCallId && name === "CalendarEvent/get",
    );
    if (!getInvocation) {
      const errorInvocation = response.methodResponses.find(([name]) => name === "error");
      const detail = errorInvocation ? JSON.stringify(errorInvocation[1]) : "no response";
      throw new Error(`Windowed CalendarEvent fetch failed: ${detail}`);
    }
    const getResponse = getInvocation[1] as unknown as GetResponse<JmapCalendarEvent>;
    this.client.setState(accountId, CALENDAR_EVENT_TYPE, getResponse.state);
    return getResponse;
  }
}
