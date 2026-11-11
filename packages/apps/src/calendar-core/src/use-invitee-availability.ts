import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { CalendarInvitee } from "@/lib/models/calendar-attendees";
import type { CalendarEventFormValue } from "@/calendar-core/src/calendar-editor-model";
import {
  availabilityExcludeEventId,
  availabilityWeekRange,
  eventAvailabilitySpan,
  inviteeAvailabilityFromResponse,
  teammateAttendees,
  type InviteeAvailabilityMap,
  type TeamAvailabilityMember,
  type TeamAvailabilitySource,
} from "@/calendar-core/src/calendar-invitee-availability";
import { useCalendarDisplayPrefs } from "@/calendar-core/src/use-calendar-display-prefs";
import { useConnectivity } from "@/hooks/use-connectivity";

/** Wait this long after the last time, all-day or invitee change before asking. */
export const INVITEE_AVAILABILITY_DEBOUNCE_MS = 400;

const EMPTY: InviteeAvailabilityMap = new Map();

const TeamAvailabilityContext = createContext<TeamAvailabilitySource | null>(null);

/** Gives the event editor a way to ask for teammates' availability. No provider → no tags. */
export function TeamAvailabilityProvider({
  source,
  children,
}: {
  source: TeamAvailabilitySource | null;
  children: ReactNode;
}) {
  return createElement(TeamAvailabilityContext.Provider, { value: source }, children);
}

export type UseInviteeAvailabilityOptions = {
  form: Pick<
    CalendarEventFormValue,
    "allDay" | "startDate" | "startTime" | "endDate" | "endTime" | "timeZone" | "attendees"
  >;
  invitees: readonly CalendarInvitee[];
  /** Saved event being edited: its own copies never make an invitee busy. */
  eventId?: string;
  /** Hidden invitee list, read-only view, … */
  enabled?: boolean;
};

/**
 * Free/Busy per invited teammate for the event's own time. Online only; offline, on error,
 * or for people who are not teammates sharing availability, the map has no entry.
 */
export function useInviteeAvailability({
  form,
  invitees,
  eventId,
  enabled = true,
}: UseInviteeAvailabilityOptions): InviteeAvailabilityMap {
  const source = useContext(TeamAvailabilityContext);
  const { online } = useConnectivity();
  const { timeZone } = useCalendarDisplayPrefs();
  const active = Boolean(source) && enabled && online;
  const hasAttendees = form.attendees.length > 0;

  const [members, setMembers] = useState<TeamAvailabilityMember[] | null>(null);
  useEffect(() => {
    if (!active || !hasAttendees || !source || members) return;
    let cancelled = false;
    source.teamMembers().then(
      (list) => {
        if (!cancelled) setMembers(list);
      },
      () => {
        if (!cancelled) setMembers([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active, hasAttendees, source, members]);

  const { allDay, startDate, startTime, endDate, endTime, timeZone: eventTimeZone } = form;
  const span = useMemo(
    () =>
      eventAvailabilitySpan(
        { allDay, startDate, startTime, endDate, endTime, timeZone: eventTimeZone },
        timeZone,
      ),
    [allDay, startDate, startTime, endDate, endTime, eventTimeZone, timeZone],
  );
  const attendeeById = useMemo(
    () =>
      members ? teammateAttendees(form.attendees, invitees, members) : new Map<string, string>(),
    [form.attendees, invitees, members],
  );
  const excludeEventId = availabilityExcludeEventId(eventId);
  const range = span ? availabilityWeekRange(span) : null;
  const ids = [...attendeeById.keys()].sort();
  const requestKey =
    active && span && range && ids.length
      ? JSON.stringify([ids, range.utcStart, range.utcEnd, excludeEventId ?? ""])
      : "";
  const resultKey = requestKey && span ? `${requestKey}|${span.start}|${span.end}` : "";

  const [answer, setAnswer] = useState<{ key: string; map: InviteeAvailabilityMap }>({
    key: "",
    map: EMPTY,
  });

  // The effect runs per request key; the ref hands it this render's values.
  const latest = useRef({ source, span, range, ids, excludeEventId, attendeeById, timeZone });
  latest.current = { source, span, range, ids, excludeEventId, attendeeById, timeZone };

  useEffect(() => {
    const request = latest.current;
    if (!resultKey || !request.source || !request.span || !request.range) return;
    const { source: from, span: eventSpan, range: weeks } = request;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      from
        .availability({
          ids: request.ids,
          utcStart: weeks.utcStart,
          utcEnd: weeks.utcEnd,
          ...(request.excludeEventId ? { excludeEventId: request.excludeEventId } : {}),
        })
        .then(
          (people) => {
            if (cancelled) return;
            setAnswer({
              key: resultKey,
              map: inviteeAvailabilityFromResponse(
                people,
                request.attendeeById,
                eventSpan,
                request.timeZone,
              ),
            });
          },
          () => {
            if (!cancelled) setAnswer({ key: resultKey, map: EMPTY });
          },
        );
    }, INVITEE_AVAILABILITY_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [resultKey]);

  // A stale answer (other time or invitees) never shows: no tag until the new one is in.
  return resultKey && answer.key === resultKey ? answer.map : EMPTY;
}
