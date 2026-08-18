import { Temporal } from "@js-temporal/polyfill";
import type {
  JmapCalendar,
  JmapCalendarEvent,
  JmapCalendarEventFilterCondition,
} from "../calendars/types.js";
import type { JmapFetch } from "../core/JmapClient.js";
import type { JmapInvocation, JmapResponse, JmapSession, JmapSetError } from "../core/types.js";

const SESSION_URL = "https://mock.example/jmap/session";
const API_URL = "https://mock.example/jmap/api";
const ACCOUNT_ID = "account1";

type ChangeLogEntry = {
  state: number;
  type: "Calendar" | "CalendarEvent";
  kind: "created" | "updated" | "destroyed";
  id: string;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Minimal JSON-pointer resolution for JMAP ResultReference paths like "/ids". */
function resolvePointer(value: unknown, path: string): unknown {
  const segments = path.split("/").filter(Boolean);
  let current: unknown = value;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Naive UTC millis for a JSCalendar LocalDateTime (mock ignores time zones). */
function toMillis(local: string): number {
  return Date.parse(`${local}Z`);
}

function durationToMillis(duration: string | undefined): number {
  if (!duration) return 0;
  try {
    return Temporal.Duration.from(duration).total({ unit: "milliseconds" });
  } catch {
    return 0;
  }
}

/**
 * An in-memory JMAP calendars server backing contract tests: session resource, batched
 * method calls with ResultReference support, per-type states with a change log, and the
 * Calendar/CalendarEvent get/changes/set/query/queryChanges methods.
 */
export class MockJmapServer {
  readonly sessionUrl = SESSION_URL;
  readonly apiUrl = API_URL;
  readonly accountId = ACCOUNT_ID;

  calendars = new Map<string, JmapCalendar>();
  events = new Map<string, JmapCalendarEvent>();

  #stateCounter = 1;
  #changeLog: ChangeLogEntry[] = [];
  #idCounter = 0;
  #sessionState = "session-1";

  /** Number of POST requests handled; useful for asserting batching behavior. */
  requestCount = 0;
  /** When set, the next CalendarEvent/set update/create is rejected with this SetError. */
  failNextSetWith: JmapSetError | null = null;

  get state(): string {
    return String(this.#stateCounter);
  }

  #bumpState(type: ChangeLogEntry["type"], kind: ChangeLogEntry["kind"], id: string): void {
    this.#stateCounter += 1;
    this.#changeLog.push({ state: this.#stateCounter, type, kind, id });
  }

  /** Seeds a calendar without recording a change-log entry (initial data). */
  seedCalendar(calendar: JmapCalendar): void {
    this.calendars.set(calendar.id, calendar);
  }

  seedEvent(event: JmapCalendarEvent): void {
    this.events.set(event.id, event);
  }

  /** Server-side mutation helpers for simulating remote changes. */
  remoteUpdateEvent(id: string, patch: Partial<JmapCalendarEvent>): void {
    const existing = this.events.get(id);
    if (!existing) throw new Error(`No event ${id}`);
    this.events.set(id, { ...existing, ...patch });
    this.#bumpState("CalendarEvent", "updated", id);
  }

  remoteCreateEvent(event: Omit<JmapCalendarEvent, "id">): string {
    const id = this.nextId("ev");
    this.events.set(id, { ...(event as JmapCalendarEvent), id });
    this.#bumpState("CalendarEvent", "created", id);
    return id;
  }

  remoteDestroyEvent(id: string): void {
    this.events.delete(id);
    this.#bumpState("CalendarEvent", "destroyed", id);
  }

  nextId(prefix: string): string {
    this.#idCounter += 1;
    return `${prefix}-${this.#idCounter}`;
  }

  session(): JmapSession {
    return {
      capabilities: {
        "urn:ietf:params:jmap:core": {},
        "urn:ietf:params:jmap:calendars": {},
      },
      accounts: {
        [ACCOUNT_ID]: {
          name: "user@example.com",
          isPersonal: true,
          isReadOnly: false,
          accountCapabilities: { "urn:ietf:params:jmap:calendars": {} },
        },
      },
      primaryAccounts: { "urn:ietf:params:jmap:calendars": ACCOUNT_ID },
      username: "user@example.com",
      apiUrl: API_URL,
      downloadUrl: `${API_URL}/download`,
      uploadUrl: `${API_URL}/upload`,
      eventSourceUrl: `${API_URL}/eventsource`,
      state: this.#sessionState,
    };
  }

  /** A fetch implementation to hand to {@link JmapClient}. */
  get fetch(): JmapFetch {
    return async (input, init) => {
      if (input === SESSION_URL) return json(this.session());
      if (input === API_URL && init?.method === "POST") {
        this.requestCount += 1;
        const request = JSON.parse(String(init.body)) as { methodCalls: JmapInvocation[] };
        return json(this.#handleRequest(request.methodCalls));
      }
      return json({ type: "urn:ietf:params:jmap:error:notFound" }, 404);
    };
  }

  #handleRequest(methodCalls: JmapInvocation[]): JmapResponse {
    const methodResponses: JmapInvocation[] = [];
    for (const [name, rawArgs, callId] of methodCalls) {
      const args = this.#resolveReferences(rawArgs, methodResponses);
      try {
        const result = this.#dispatch(name, args);
        methodResponses.push([name, result, callId]);
      } catch (error) {
        const type = error instanceof MethodError ? error.type : "serverFail";
        methodResponses.push(["error", { type, description: String(error) }, callId]);
      }
    }
    return { methodResponses, sessionState: this.#sessionState };
  }

  #resolveReferences(
    args: Record<string, unknown>,
    responses: JmapInvocation[],
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (!key.startsWith("#")) {
        resolved[key] = value;
        continue;
      }
      const reference = value as { resultOf: string; name: string; path: string };
      const match = responses.find(
        ([name, , id]) => id === reference.resultOf && name === reference.name,
      );
      if (!match) throw new MethodError("invalidResultReference");
      resolved[key.slice(1)] = resolvePointer(match[1], reference.path);
    }
    return resolved;
  }

  #dispatch(name: string, args: Record<string, unknown>): Record<string, unknown> {
    switch (name) {
      case "Calendar/get":
        return this.#get(this.calendars, args);
      case "CalendarEvent/get":
        return this.#get(this.events, args);
      case "Calendar/changes":
        return this.#changes("Calendar", args);
      case "CalendarEvent/changes":
        return this.#changes("CalendarEvent", args);
      case "Calendar/set":
        return this.#set("Calendar", this.calendars, args, () => this.nextId("cal"));
      case "CalendarEvent/set":
        return this.#set("CalendarEvent", this.events, args, () => this.nextId("ev"));
      case "CalendarEvent/query":
        return this.#query(args);
      case "CalendarEvent/queryChanges":
        throw new MethodError("cannotCalculateChanges");
      default:
        throw new MethodError("unknownMethod");
    }
  }

  #get(store: Map<string, { id: string }>, args: Record<string, unknown>): Record<string, unknown> {
    const ids = (args.ids as string[] | null | undefined) ?? null;
    const list: unknown[] = [];
    const notFound: string[] = [];
    if (ids === null) {
      list.push(...store.values());
    } else {
      for (const id of ids) {
        const item = store.get(id);
        if (item) list.push(item);
        else notFound.push(id);
      }
    }
    return { accountId: ACCOUNT_ID, state: this.state, list, notFound };
  }

  #changes(type: ChangeLogEntry["type"], args: Record<string, unknown>): Record<string, unknown> {
    const sinceState = Number(args.sinceState);
    if (!Number.isFinite(sinceState)) throw new MethodError("cannotCalculateChanges");
    const created = new Set<string>();
    const updated = new Set<string>();
    const destroyed = new Set<string>();
    for (const entry of this.#changeLog) {
      if (entry.type !== type || entry.state <= sinceState) continue;
      if (entry.kind === "created") created.add(entry.id);
      else if (entry.kind === "updated") {
        if (!created.has(entry.id)) updated.add(entry.id);
      } else {
        if (created.has(entry.id)) created.delete(entry.id);
        else destroyed.add(entry.id);
        updated.delete(entry.id);
      }
    }
    return {
      accountId: ACCOUNT_ID,
      oldState: String(sinceState),
      newState: this.state,
      hasMoreChanges: false,
      created: [...created],
      updated: [...updated],
      destroyed: [...destroyed],
    };
  }

  #set(
    type: ChangeLogEntry["type"],
    store: Map<string, { id: string }>,
    args: Record<string, unknown>,
    generateId: () => string,
  ): Record<string, unknown> {
    const response: Record<string, unknown> = {
      accountId: ACCOUNT_ID,
      oldState: this.state,
    };
    const created: Record<string, unknown> = {};
    const updated: Record<string, unknown> = {};
    const destroyed: string[] = [];
    const notCreated: Record<string, JmapSetError> = {};
    const notUpdated: Record<string, JmapSetError> = {};

    for (const [creationId, record] of Object.entries(
      (args.create as Record<string, Record<string, unknown>> | null | undefined) ?? {},
    )) {
      if (type === "CalendarEvent" && this.failNextSetWith) {
        notCreated[creationId] = this.failNextSetWith;
        this.failNextSetWith = null;
        continue;
      }
      const id = generateId();
      store.set(id, { ...record, id } as { id: string });
      this.#bumpState(type, "created", id);
      created[creationId] = { id };
    }

    for (const [id, patch] of Object.entries(
      (args.update as Record<string, Record<string, unknown>> | null | undefined) ?? {},
    )) {
      if (type === "CalendarEvent" && this.failNextSetWith) {
        notUpdated[id] = this.failNextSetWith;
        this.failNextSetWith = null;
        continue;
      }
      const existing = store.get(id);
      if (!existing) {
        notUpdated[id] = { type: "notFound" };
        continue;
      }
      store.set(id, { ...existing, ...patch, id });
      this.#bumpState(type, "updated", id);
      updated[id] = null;
    }

    for (const id of (args.destroy as string[] | null | undefined) ?? []) {
      if (!store.delete(id)) continue;
      this.#bumpState(type, "destroyed", id);
      destroyed.push(id);
    }

    response.newState = this.state;
    if (Object.keys(created).length) response.created = created;
    if (Object.keys(updated).length) response.updated = updated;
    if (destroyed.length) response.destroyed = destroyed;
    if (Object.keys(notCreated).length) response.notCreated = notCreated;
    if (Object.keys(notUpdated).length) response.notUpdated = notUpdated;
    return response;
  }

  #query(args: Record<string, unknown>): Record<string, unknown> {
    const filter = (args.filter ?? {}) as JmapCalendarEventFilterCondition;
    const after = filter.after ? Date.parse(filter.after) : undefined;
    const before = filter.before ? Date.parse(filter.before) : undefined;
    const inCalendars = filter.inCalendars ?? null;
    const ids: string[] = [];
    for (const event of this.events.values()) {
      if (inCalendars && !inCalendars.some((id) => event.calendarIds[id])) continue;
      if (filter.uid && event.uid !== filter.uid) continue;
      const start = toMillis(event.start);
      const end = start + durationToMillis(event.duration);
      const recurring = Boolean(event.recurrenceRules?.length);
      if (before !== undefined && start >= before) continue;
      if (after !== undefined && !recurring && end <= after) continue;
      ids.push(event.id);
    }
    return {
      accountId: ACCOUNT_ID,
      queryState: this.state,
      canCalculateChanges: false,
      position: 0,
      ids,
    };
  }
}

class MethodError extends Error {
  readonly type: string;
  constructor(type: string) {
    super(type);
    this.type = type;
  }
}
