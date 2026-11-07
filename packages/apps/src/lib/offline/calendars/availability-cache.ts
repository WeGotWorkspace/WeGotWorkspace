import {
  calendarsAvailabilityTable,
  calendarsTeamMembersTable,
  type OfflineCalendarAvailabilityRow,
} from "@/lib/offline/calendars/calendars-schema";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  splitBusyPeriodsByWeek,
  type AvailabilityCallPlan,
  type UtcWeekStart,
} from "@/lib/jmap-client/availability/availability-weeks";
import type {
  JmapBusyPeriod,
  JmapTeamMember,
  JmapTeamMemberGetAvailabilityResponse,
} from "@/lib/jmap-client/availability/types";

const META_TEAM_MEMBERS_STATE = "calendars:teamMembers:state";
const DAY_MS = 24 * 60 * 60 * 1000;
/** Weeks outside the prefetch window are dropped after this long. */
export const AVAILABILITY_CACHE_MAX_AGE_MS = 30 * DAY_MS;
/** Cached weeks kept per teammate; the oldest fetches go first. */
export const AVAILABILITY_CACHE_MAX_WEEKS_PER_PERSON = 60;

export type CachedTeamMembers = { state: string; list: JmapTeamMember[] };

export type AvailabilityWeek = {
  username: string;
  weekStart: UtcWeekStart;
  periods: JmapBusyPeriod[];
  complete: boolean;
  version: string;
  fetchedAt: number;
};

function db(viewer: string) {
  return offlineDbForAccount(offlineAccountKeyFromUsername(viewer));
}

function toRow(week: AvailabilityWeek): OfflineCalendarAvailabilityRow {
  return { ...week, periods: JSON.stringify(week.periods) };
}

function fromRow(row: OfflineCalendarAvailabilityRow): AvailabilityWeek {
  let periods: JmapBusyPeriod[] = [];
  try {
    const parsed: unknown = JSON.parse(row.periods);
    if (Array.isArray(parsed)) periods = parsed as JmapBusyPeriod[];
  } catch {
    // A broken row reads as no periods; the next fetch replaces it.
  }
  return { ...row, periods };
}

export async function readCachedTeamMembers(viewer: string): Promise<CachedTeamMembers | null> {
  const database = db(viewer);
  const state = await database.meta.get(META_TEAM_MEMBERS_STATE);
  if (!state) return null;
  const rows = (await calendarsTeamMembersTable(database).toArray()).sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
  return { state: state.value, list: rows.map((row) => JSON.parse(row.data) as JmapTeamMember) };
}

/**
 * Stores the teammates list and drops every cached week of a person whose
 * `version` changed or who left the list. A switch back to "Time only" must
 * not leave their titles in the cache. Returns the usernames dropped.
 */
export async function writeCachedTeamMembers(
  viewer: string,
  members: CachedTeamMembers,
): Promise<string[]> {
  const database = db(viewer);
  const weeks = calendarsAvailabilityTable(database);
  const current = new Map(members.list.map((member) => [member.id, member.version]));
  const stale = new Set<string>();
  await weeks.each((row) => {
    if (current.get(row.username) !== row.version) stale.add(row.username);
  });
  await database.transaction(
    "rw",
    [calendarsTeamMembersTable(database), weeks, database.meta],
    async () => {
      const table = calendarsTeamMembersTable(database);
      await table.clear();
      await table.bulkPut(
        members.list.map((member, sortOrder) => ({
          id: member.id,
          sortOrder,
          data: JSON.stringify(member),
        })),
      );
      if (stale.size > 0)
        await weeks
          .where("username")
          .anyOf([...stale])
          .delete();
      await database.meta.put({ key: META_TEAM_MEMBERS_STATE, value: members.state });
    },
  );
  return [...stale];
}

/** Cache rows for one answered call: every week of the run, for every person. */
export function availabilityWeeksFromResponse(
  plan: AvailabilityCallPlan,
  response: JmapTeamMemberGetAvailabilityResponse,
  versions: ReadonlyMap<string, string>,
  fetchedAt: number,
): AvailabilityWeek[] {
  const weeks: AvailabilityWeek[] = [];
  for (const person of response.list) {
    const version = versions.get(person.id);
    if (version === undefined) continue;
    const byWeek = splitBusyPeriodsByWeek(person.periods, plan.weeks);
    for (const [weekStart, periods] of byWeek) {
      // The server's `complete` covers the whole run, so it goes on every week.
      weeks.push({
        username: person.id,
        weekStart,
        periods,
        complete: person.complete,
        version,
        fetchedAt,
      });
    }
  }
  return weeks;
}

export async function writeAvailabilityWeeks(
  viewer: string,
  weeks: readonly AvailabilityWeek[],
): Promise<void> {
  if (weeks.length === 0) return;
  await calendarsAvailabilityTable(db(viewer)).bulkPut(weeks.map(toRow));
}

/** Drops every cached week of these people (no longer visible to the viewer). */
export async function dropAvailabilityFor(
  viewer: string,
  usernames: readonly string[],
): Promise<void> {
  if (usernames.length === 0) return;
  await calendarsAvailabilityTable(db(viewer))
    .where("username")
    .anyOf([...usernames])
    .delete();
}

export async function readAvailabilityWeeks(
  viewer: string,
  usernames: readonly string[],
  weekStarts: readonly UtcWeekStart[],
): Promise<AvailabilityWeek[]> {
  if (usernames.length === 0 || weekStarts.length === 0) return [];
  const keys = usernames.flatMap((username) =>
    weekStarts.map((weekStart) => [username, weekStart] as [string, string]),
  );
  const rows = await calendarsAvailabilityTable(db(viewer)).bulkGet(keys);
  return rows.filter((row): row is OfflineCalendarAvailabilityRow => row != null).map(fromRow);
}

/**
 * Weeks outside the prefetch window fetched over 30 days ago go, and each
 * person keeps at most 60 weeks (oldest fetch first, prefetch window last).
 */
export async function evictAvailabilityWeeks(
  viewer: string,
  options: { now: number; keepWeeks: readonly UtcWeekStart[] },
): Promise<number> {
  const table = calendarsAvailabilityTable(db(viewer));
  const keep = new Set(options.keepWeeks);
  const cutoff = options.now - AVAILABILITY_CACHE_MAX_AGE_MS;
  const rows = await table.toArray();
  const doomed: [string, string][] = [];
  const byPerson = new Map<string, OfflineCalendarAvailabilityRow[]>();
  for (const row of rows) {
    if (!keep.has(row.weekStart) && row.fetchedAt < cutoff) {
      doomed.push([row.username, row.weekStart]);
      continue;
    }
    byPerson.set(row.username, [...(byPerson.get(row.username) ?? []), row]);
  }
  for (const personRows of byPerson.values()) {
    const excess = personRows.length - AVAILABILITY_CACHE_MAX_WEEKS_PER_PERSON;
    if (excess <= 0) continue;
    const oldestFirst = [...personRows].sort(
      (left, right) =>
        Number(keep.has(left.weekStart)) - Number(keep.has(right.weekStart)) ||
        left.fetchedAt - right.fetchedAt ||
        left.weekStart.localeCompare(right.weekStart),
    );
    for (const row of oldestFirst.slice(0, excess)) doomed.push([row.username, row.weekStart]);
  }
  if (doomed.length > 0) await table.bulkDelete(doomed);
  return doomed.length;
}
