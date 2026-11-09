import { Temporal } from "@js-temporal/polyfill";
import type {
  CalendarAvailabilityBusyPeriod,
  CalendarAvailabilityTeamMember,
} from "@wgw/openapi-types/calendars-types";

/** Limits of TeamMember/getAvailability, as the WGW server advertises and enforces them. */
export const AVAILABILITY_LIMITS = {
  maxIdsPerCall: 50,
  maxWeeksPerCall: 54,
  maxPersonWeeksPerCall: 540,
} as const;

/**
 * A seeded busy period. `eventId` is mock-only: it lets `excludeEventId` drop the period,
 * like the server drops every occurrence of that event's UID. It is never sent to clients.
 */
export type MockBusyPeriod = CalendarAvailabilityBusyPeriod & { eventId?: string };

type MockPerson = { periods: MockBusyPeriod[]; complete: boolean };

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export class AvailabilityMethodError extends Error {
  readonly type: string;
  constructor(type: string, description: string) {
    super(description);
    this.type = type;
  }
}

/** Instants of a period, read like a CalendarEvent's time fields (floating and dates as UTC). */
function periodBounds(period: CalendarAvailabilityBusyPeriod): [number, number] {
  const duration = Temporal.Duration.from(period.duration);
  let start: Temporal.ZonedDateTime;
  if (period.start.endsWith("Z")) {
    start = Temporal.Instant.from(period.start).toZonedDateTimeISO("UTC");
  } else {
    const local = period.start.includes("T")
      ? Temporal.PlainDateTime.from(period.start)
      : Temporal.PlainDate.from(period.start).toPlainDateTime();
    start = local.toZonedDateTime(period.timeZone ?? "UTC");
  }
  return [start.epochMilliseconds, start.add(duration).epochMilliseconds];
}

function invalid(description: string): AvailabilityMethodError {
  return new AvailabilityMethodError("invalidArguments", description);
}

/**
 * The `urn:wgw:jmap:availability` methods of {@link MockJmapServer}: TeamMember/get and
 * TeamMember/getAvailability, with the server's whole-UTC-week and size rules.
 * Seed people with {@link seedTeamMember} and their busy time with {@link seedBusyPeriods}.
 */
export class MockAvailability {
  readonly members = new Map<string, CalendarAvailabilityTeamMember>();
  readonly people = new Map<string, MockPerson>();

  constructor(
    private readonly accountId: string,
    private readonly eventExists: (eventId: string) => boolean,
  ) {}

  seedTeamMember(member: CalendarAvailabilityTeamMember): void {
    this.members.set(member.id, member);
  }

  /** Removes a person, as when they turn the switch off or leave the shared Team. */
  removeTeamMember(id: string): void {
    this.members.delete(id);
  }

  seedBusyPeriods(id: string, periods: MockBusyPeriod[], complete = true): void {
    this.people.set(id, { periods, complete });
  }

  get state(): string {
    return [...this.members.values()]
      .map((member) => `${member.id}:${member.version}`)
      .sort()
      .join(",");
  }

  handle(method: string, args: Record<string, unknown>): Record<string, unknown> {
    if (method === "get") return this.#get(args);
    if (method === "getAvailability") return this.#getAvailability(args);
    throw new AvailabilityMethodError("unknownMethod", `TeamMember/${method}`);
  }

  #get(args: Record<string, unknown>): Record<string, unknown> {
    const ids = (args.ids as string[] | null | undefined) ?? null;
    const list: CalendarAvailabilityTeamMember[] = [];
    const notFound: string[] = [];
    for (const id of ids ?? [...this.members.keys()]) {
      const member = this.members.get(id);
      if (member) list.push(member);
      else notFound.push(id);
    }
    return { accountId: this.accountId, state: this.state, list, notFound };
  }

  #getAvailability(args: Record<string, unknown>): Record<string, unknown> {
    const ids = args.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string")) {
      throw invalid("ids must be a non-empty array of ids.");
    }
    if (ids.length > AVAILABILITY_LIMITS.maxIdsPerCall) throw invalid("Too many ids.");
    const [start, end] = this.#weekRange(args.utcStart, args.utcEnd);
    const weeks = (end - start) / WEEK_MS;
    if (weeks * ids.length > AVAILABILITY_LIMITS.maxPersonWeeksPerCall) {
      throw invalid("ids × weeks exceeds maxPersonWeeksPerCall.");
    }
    const excludeEventId = args.excludeEventId;
    if (
      excludeEventId !== undefined &&
      (typeof excludeEventId !== "string" || !this.eventExists(excludeEventId))
    ) {
      throw invalid("excludeEventId is not an event the caller may edit or attends.");
    }

    const list: Record<string, unknown>[] = [];
    const notFound: string[] = [];
    for (const id of new Set(ids as string[])) {
      const person = this.people.get(id) ?? { periods: [], complete: true };
      if (!this.members.has(id)) {
        notFound.push(id);
        continue;
      }
      const periods = person.periods
        .filter((period) => period.eventId === undefined || period.eventId !== excludeEventId)
        .filter((period) => {
          const [periodStart, periodEnd] = periodBounds(period);
          return (
            periodStart < end &&
            (periodEnd > start || (periodEnd === periodStart && periodStart >= start))
          );
        })
        .sort((a, b) => periodBounds(a)[0] - periodBounds(b)[0])
        .map(({ eventId: _eventId, ...period }) => period);
      list.push({ id, periods, complete: person.complete });
    }
    return { accountId: this.accountId, list, notFound };
  }

  #weekRange(utcStart: unknown, utcEnd: unknown): [number, number] {
    if (typeof utcStart !== "string" || typeof utcEnd !== "string") {
      throw invalid("utcStart and utcEnd are required.");
    }
    let start: Temporal.ZonedDateTime;
    let end: Temporal.ZonedDateTime;
    try {
      start = Temporal.Instant.from(utcStart).toZonedDateTimeISO("UTC");
      end = Temporal.Instant.from(utcEnd).toZonedDateTimeISO("UTC");
    } catch {
      throw invalid("utcStart and utcEnd must be UTC date-times.");
    }
    const midnight =
      start.hour === 0 && start.minute === 0 && start.second === 0 && start.millisecond === 0;
    if (start.dayOfWeek !== 1 || !midnight) throw invalid("utcStart must be a Monday 00:00:00Z.");
    const span = end.epochMilliseconds - start.epochMilliseconds;
    if (span <= 0 || span % WEEK_MS !== 0) throw invalid("The range must be whole weeks.");
    if (span / WEEK_MS > AVAILABILITY_LIMITS.maxWeeksPerCall)
      throw invalid("At most 54 weeks per call.");
    return [start.epochMilliseconds, end.epochMilliseconds];
  }
}
