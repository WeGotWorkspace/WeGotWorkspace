import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
import type { JmapClient } from "@/lib/jmap-client";
import { JmapAvailabilityClient } from "@/lib/jmap-client/availability/JmapAvailabilityClient";
import {
  mergeWeekPeriods,
  planAvailabilityCalls,
  prefetchUtcWeeks,
  utcWeeksForDates,
  type UtcWeekStart,
} from "@/lib/jmap-client/availability/availability-weeks";
import type {
  JmapBusyPeriod,
  JmapTeamMember,
  JmapTeamMemberGetAvailabilityArgs,
  JmapTeamMemberGetAvailabilityResponse,
  JmapTeamMemberGetResponse,
} from "@/lib/jmap-client/availability/types";
import {
  availabilityWeeksFromResponse,
  dropAvailabilityFor,
  evictAvailabilityWeeks,
  readAvailabilityWeeks,
  readCachedTeamMembers,
  writeAvailabilityWeeks,
  writeCachedTeamMembers,
  type AvailabilityWeek,
  type CachedTeamMembers,
} from "@/lib/offline/calendars/availability-cache";
import { viewDateRange } from "@/calendar-core/src/calendar-event-model";
import type { CalendarViewId } from "@/lib/models/calendar-types";
import {
  buildAvailabilityOverlayEvents,
  resolveAvailabilityColors,
  type AvailabilityColors,
} from "@/calendar-core/src/calendar-availability-overlay";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { useCalendarSectionCollapsed } from "@/calendar-core/src/use-calendar-section-collapsed";
import { withIds } from "@/sidebar-section/src/section-toggle-all";
import type { TeamAvailabilityCoverage } from "@/calendar-core/src/calendar-availability-notice";
import {
  patchCalendarViewPrefs,
  readCalendarViewPrefs,
} from "@/calendar-core/src/calendar-view-prefs";

/** Availability does not need the 10-second calendar poll (`calendar-refresh.ts`). */
export const TEAM_AVAILABILITY_TICK_MS = 60_000;

/** `TeamMember/get` and `TeamMember/getAvailability`; null members = server lacks the capability. */
export type TeamAvailabilitySource = {
  getTeamMembers: () => Promise<JmapTeamMemberGetResponse | null>;
  getAvailability: (
    args: JmapTeamMemberGetAvailabilityArgs,
  ) => Promise<JmapTeamMemberGetAvailabilityResponse>;
};

export function teamAvailabilitySourceFromJmap(client: JmapClient): TeamAvailabilitySource {
  const availability = new JmapAvailabilityClient(client);
  const ready = async () => {
    if (!client.isConnected) await client.connect();
    return availability.isSupported();
  };
  return {
    getTeamMembers: async () => ((await ready()) ? availability.getTeamMembers() : null),
    getAvailability: async (args) => {
      await ready();
      return availability.getAvailability(args);
    },
  };
}

/** Story/test fixture: no Dexie, no network. */
export type TeamAvailabilityPreset = {
  members: JmapTeamMember[];
  weeks: AvailabilityWeek[];
  /** Ticked usernames (instead of the device prefs). */
  shownIds?: string[];
  /** Paint as if offline (the offline notice story). */
  offline?: boolean;
};

export type UseTeamAvailabilityArgs = {
  source?: TeamAvailabilitySource | null;
  /** Offline account (the signed-in username); no viewer = nothing cached. */
  viewer?: string | null;
  view: CalendarViewId;
  anchor: string;
  weekStart?: number;
  online: boolean;
  preset?: TeamAvailabilityPreset | null;
  now?: () => number;
  tickMs?: number;
  /** Title of untitled busy blocks. */
  busyLabel?: string;
};

export type TeamAvailabilityState = {
  /** The connection state the section and notice go by. */
  online: boolean;
  /** Own row first (when the caller shares), then teammates by name. Null until known. */
  members: JmapTeamMember[] | null;
  shownIds: ReadonlySet<string>;
  toggleShown: (id: string) => void;
  /** Ticks or unticks several rows at once (the section's show/hide-all dot). */
  setShown: (ids: readonly string[], shown: boolean) => void;
  collapsed: boolean;
  toggleCollapsed: () => void;
  /** Teammates whose weeks in view came back `complete: false`. */
  incompleteIds: ReadonlySet<string>;
  periodsByUser: ReadonlyMap<string, JmapBusyPeriod[]>;
  /** One distinct colour per listed person (ticked or not), for rows, blocks and popovers. */
  colors: AvailabilityColors;
  overlayEvents: CalendarEventsMap;
  coverage: TeamAvailabilityCoverage;
};

/** The UTC weeks a view needs, for a viewer in any time zone. */
export function visibleAvailabilityWeeks(
  view: CalendarViewId,
  anchor: string,
  weekStart = 1,
): UtcWeekStart[] {
  try {
    const { start, end } = viewDateRange(view, anchor, weekStart);
    return utcWeeksForDates(start, end);
  } catch {
    return [];
  }
}

export function orderTeamMembers(list: readonly JmapTeamMember[]): JmapTeamMember[] {
  return [...list].sort(
    (left, right) =>
      Number(right.isSelf) - Number(left.isSelf) ||
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
}

function readShownIds(): Set<string> {
  return new Set(readCalendarViewPrefs()?.shownAvailabilityIds ?? []);
}

function summarize(
  rows: readonly AvailabilityWeek[],
  shown: readonly string[],
  weeks: readonly UtcWeekStart[],
) {
  const byUser = new Map<string, AvailabilityWeek[]>();
  for (const row of rows) byUser.set(row.username, [...(byUser.get(row.username) ?? []), row]);
  const periodsByUser = new Map<string, JmapBusyPeriod[]>();
  const incompleteIds = new Set<string>();
  let oldestFetchedAt: number | null = null;
  let uncachedWeeks = false;
  for (const id of shown) {
    const personRows = byUser.get(id) ?? [];
    periodsByUser.set(id, mergeWeekPeriods(personRows));
    if (personRows.some((row) => !row.complete)) incompleteIds.add(id);
    if (personRows.length < weeks.length) uncachedWeeks = true;
    for (const row of personRows) {
      if (oldestFetchedAt === null || row.fetchedAt < oldestFetchedAt) {
        oldestFetchedAt = row.fetchedAt;
      }
    }
  }
  return { periodsByUser, incompleteIds, coverage: { oldestFetchedAt, uncachedWeeks } };
}

/** Ticked rows and the folded state, stored per device in the calendar view prefs. */
function useTeamAvailabilityPrefs(presetShownIds: readonly string[] | undefined) {
  const [shownIds, setShownIds] = useState<ReadonlySet<string>>(() =>
    presetShownIds ? new Set(presetShownIds) : readShownIds(),
  );
  const { collapsed, toggleCollapsed } = useCalendarSectionCollapsed("availabilityCollapsed");
  const updateShown = useCallback((change: (current: ReadonlySet<string>) => Set<string>) => {
    setShownIds((current) => {
      const next = change(current);
      patchCalendarViewPrefs({ shownAvailabilityIds: [...next] });
      return next;
    });
  }, []);
  const toggleShown = useCallback(
    (id: string) => updateShown((current) => withIds(current, [id], !current.has(id))),
    [updateShown],
  );
  const setShown = useCallback(
    (ids: readonly string[], shown: boolean) =>
      updateShown((current) => withIds(current, ids, shown)),
    [updateShown],
  );
  return { shownIds, toggleShown, setShown, collapsed, toggleCollapsed };
}

/**
 * Team availability for the Calendar sidebar and grid (#1910). Only ticked
 * teammates are fetched: the weeks in view at once on every range change,
 * and on a 60-second tick the `TeamMember/get` state, the weeks in view and
 * the prefetch window (current week + 4). Everything fetched goes through the
 * per-week Dexie cache, which is also what paints, online and offline.
 */
export function useTeamAvailability({
  source,
  viewer,
  view,
  anchor,
  weekStart = 1,
  online,
  preset,
  now = Date.now,
  tickMs = TEAM_AVAILABILITY_TICK_MS,
  busyLabel = defaultCalendarLabels.teamAvailabilityBusy,
}: UseTeamAvailabilityArgs): TeamAvailabilityState {
  const presetMode = preset != null;
  const live = !presetMode && Boolean(source) && Boolean(viewer);
  const [members, setMembers] = useState<CachedTeamMembers | null>(null);
  const membersRef = useRef<CachedTeamMembers | null>(null);
  const [rows, setRows] = useState<AvailabilityWeek[]>([]);
  const [revision, bumpRevision] = useReducer((value: number) => value + 1, 0);
  const { shownIds, toggleShown, setShown, collapsed, toggleCollapsed } = useTeamAvailabilityPrefs(
    preset?.shownIds,
  );
  const nowRef = useRef(now);
  nowRef.current = now;

  const visibleWeeks = useMemo(
    () => visibleAvailabilityWeeks(view, anchor, weekStart),
    [view, anchor, weekStart],
  );
  const visibleKey = visibleWeeks.join(",");
  const memberList = presetMode ? preset.members : (members?.list ?? null);
  const shownList = useMemo(
    () => (memberList ?? []).filter((member) => shownIds.has(member.id)).map((m) => m.id),
    [memberList, shownIds],
  );
  const shownKey = shownList.join(",");

  const latest = useRef({ shownList, visibleWeeks, shownIds });
  latest.current = { shownList, visibleWeeks, shownIds };
  /** `${visibleKey}|${shownKey}` last fetched, so the tick and a range change do not repeat. */
  const fetchedKeyRef = useRef("");

  const applyMembers = useCallback((next: CachedTeamMembers) => {
    membersRef.current = next;
    setMembers(next);
  }, []);

  useEffect(() => {
    if (presetMode || !viewer) return;
    let cancelled = false;
    void readCachedTeamMembers(viewer)
      .then((cached) => {
        if (!cancelled && cached && !membersRef.current) applyMembers(cached);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [applyMembers, presetMode, viewer]);

  const refreshMembers = useCallback(async (): Promise<CachedTeamMembers | null> => {
    if (!source || !viewer) return null;
    const response = await source.getTeamMembers();
    if (!response) return null;
    const next = { state: response.state, list: response.list };
    if (membersRef.current?.state !== next.state) {
      // Drops the weeks of anyone whose version changed or who left.
      await writeCachedTeamMembers(viewer, next);
      applyMembers(next);
      bumpRevision();
    }
    return next;
  }, [applyMembers, source, viewer]);

  const fetchWeeks = useCallback(
    async (ids: readonly string[], weeks: readonly UtcWeekStart[], list: JmapTeamMember[]) => {
      if (!source || !viewer) return;
      const versions = new Map(list.map((member) => [member.id, member.version]));
      const plans = planAvailabilityCalls(
        ids.filter((id) => versions.has(id)),
        weeks,
      );
      await Promise.all(
        plans.map(async (plan) => {
          const response = await source.getAvailability({
            ids: plan.ids,
            utcStart: plan.utcStart,
            utcEnd: plan.utcEnd,
          });
          await writeAvailabilityWeeks(
            viewer,
            availabilityWeeksFromResponse(plan, response, versions, nowRef.current()),
          );
          await dropAvailabilityFor(viewer, response.notFound);
        }),
      );
      if (plans.length > 0) bumpRevision();
    },
    [source, viewer],
  );

  const tick = useCallback(async () => {
    if (!viewer) return;
    try {
      const current = await refreshMembers();
      if (!current) return;
      // From the list just fetched: state set above may not have rendered yet.
      const { visibleWeeks: weeks, shownIds: shown } = latest.current;
      const ids = current.list.filter((member) => shown.has(member.id)).map((m) => m.id);
      const prefetch = prefetchUtcWeeks(Temporal.Instant.fromEpochMilliseconds(nowRef.current()));
      fetchedKeyRef.current = `${weeks.join(",")}|${ids.join(",")}`;
      await fetchWeeks(ids, [...weeks, ...prefetch], current.list);
      await evictAvailabilityWeeks(viewer, { now: nowRef.current(), keepWeeks: prefetch });
    } catch {
      // Offline or refused: the cache keeps painting; the next tick retries.
    }
  }, [fetchWeeks, refreshMembers, viewer]);

  useEffect(() => {
    if (!live || !online) return;
    void tick();
    const timer = window.setInterval(() => void tick(), tickMs);
    return () => window.clearInterval(timer);
  }, [live, online, tick, tickMs]);

  const membersKnown = members !== null;
  useEffect(() => {
    if (!live || !online || !membersKnown || shownKey === "") return;
    const key = `${visibleKey}|${shownKey}`;
    if (fetchedKeyRef.current === key) return;
    fetchedKeyRef.current = key;
    const list = membersRef.current?.list ?? [];
    void fetchWeeks(latest.current.shownList, latest.current.visibleWeeks, list).catch(() => {
      fetchedKeyRef.current = "";
    });
  }, [fetchWeeks, live, membersKnown, online, shownKey, visibleKey]);

  useEffect(() => {
    if (presetMode || !viewer) return;
    const { shownList: ids, visibleWeeks: weeks } = latest.current;
    let cancelled = false;
    void readAvailabilityWeeks(viewer, ids, weeks)
      .then((next) => {
        if (!cancelled) setRows(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [presetMode, revision, shownKey, viewer, visibleKey]);

  const summary = useMemo(() => {
    const weekSet = new Set(visibleWeeks);
    const shownSet = new Set(shownList);
    const source = presetMode
      ? preset.weeks.filter((row) => weekSet.has(row.weekStart) && shownSet.has(row.username))
      : rows.filter((row) => weekSet.has(row.weekStart) && shownSet.has(row.username));
    return summarize(source, shownList, visibleWeeks);
  }, [preset, presetMode, rows, shownList, visibleWeeks]);

  const colors = useMemo(
    () => resolveAvailabilityColors((memberList ?? []).map((member) => member.id)),
    [memberList],
  );

  const overlayEvents = useMemo(
    () => buildAvailabilityOverlayEvents(summary.periodsByUser, busyLabel, colors),
    [busyLabel, colors, summary.periodsByUser],
  );

  const orderedMembers = useMemo(
    () => (memberList ? orderTeamMembers(memberList) : null),
    [memberList],
  );

  return {
    online: presetMode && preset.offline ? false : online,
    members: orderedMembers,
    shownIds,
    toggleShown,
    setShown,
    collapsed,
    toggleCollapsed,
    incompleteIds: summary.incompleteIds,
    periodsByUser: summary.periodsByUser,
    colors,
    overlayEvents,
    coverage: summary.coverage,
  };
}
