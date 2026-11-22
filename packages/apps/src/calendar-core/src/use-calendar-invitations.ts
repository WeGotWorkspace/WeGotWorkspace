import { useCallback, useEffect, useRef, useState } from "react";
import { useJmapPushConnected, useJmapStateChange } from "@/lib/api/wgw/use-jmap-state-change";
import {
  CALENDAR_BACKGROUND_POLL_MS,
  CALENDAR_PUSH_POLL_MS,
} from "@/calendar-core/src/calendar-refresh";
import type { CalendarAPIOperations } from "@/lib/models/calendar-types";
import type { CalendarInvitee } from "@/lib/models/calendar-attendees";
import {
  CalendarSchedulingGoneError,
  type CalendarSchedulingNotification,
  type CalendarSchedulingRespondOptions,
  type CalendarSchedulingRespondStatus,
} from "@/lib/api/wgw/calendar-scheduling";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import {
  readCalendarInviteesDirectory,
  readCalendarSchedulingInbox,
  writeCalendarInviteesDirectory,
  writeCalendarSchedulingInbox,
} from "@/lib/offline/calendars/calendars-scheduling-offline-store";
import { setCalendarsSchedulingConflictListener } from "@/lib/offline/calendars/calendars-sync-conflicts";
import { resolveCalendarsOfflineUsername } from "@/lib/offline/core/offline-session";

export type UseCalendarInvitationsOptions = {
  username?: string;
  onResponded?: () => void;
  onError?: (error: unknown) => void;
  onSchedulingConflict?: (notificationIds: string[]) => void;
};

function cacheUsername(sessionUsername?: string): string | null {
  return resolveCalendarsOfflineUsername(sessionUsername);
}

function useInviteesDirectory(
  operations: CalendarAPIOperations | undefined,
  username: string | null,
) {
  const [invitees, setInvitees] = useState<CalendarInvitee[]>([]);
  const [canSubmitEmail, setCanSubmitEmail] = useState(false);

  useEffect(() => {
    if (!operations?.listInvitees) {
      if (!username) {
        setInvitees([]);
        setCanSubmitEmail(false);
        return;
      }
      void readCalendarInviteesDirectory(username).then((cached) => {
        setInvitees(cached?.list ?? []);
        setCanSubmitEmail(cached?.canSubmitEmail ?? false);
      });
      return;
    }
    if (!readBrowserOnline()) {
      if (!username) return;
      void readCalendarInviteesDirectory(username).then((cached) => {
        setInvitees(cached?.list ?? []);
        setCanSubmitEmail(cached?.canSubmitEmail ?? false);
      });
      return;
    }
    void operations
      .listInvitees()
      .then(async (next) => {
        setInvitees(next.list);
        setCanSubmitEmail(next.canSubmitEmail);
        if (username) await writeCalendarInviteesDirectory(username, next);
      })
      .catch(async () => {
        if (!username) return;
        const cached = await readCalendarInviteesDirectory(username);
        setInvitees(cached?.list ?? []);
        setCanSubmitEmail(cached?.canSubmitEmail ?? false);
      });
  }, [operations, username]);

  return { invitees, canSubmitEmail };
}

export function useCalendarInvitations(
  operations?: CalendarAPIOperations,
  options?: UseCalendarInvitationsOptions,
) {
  const [notifications, setNotifications] = useState<CalendarSchedulingNotification[]>([]);
  const [busy, setBusy] = useState(false);
  const refreshInFlightRef = useRef(false);
  const pushConnected = useJmapPushConnected();
  const username = cacheUsername(options?.username);
  const { invitees, canSubmitEmail } = useInviteesDirectory(operations, username);

  /** Resolves false only when the server list failed (the cache is shown instead). */
  const refresh = useCallback(async (): Promise<boolean> => {
    if (!operations?.listSchedulingNotifications) {
      if (username) {
        const cached = await readCalendarSchedulingInbox(username);
        setNotifications(cached);
      } else {
        setNotifications([]);
      }
      return true;
    }
    refreshInFlightRef.current = true;
    try {
      if (!readBrowserOnline()) {
        if (username) {
          setNotifications(await readCalendarSchedulingInbox(username));
        }
        return true;
      }
      try {
        const next = await operations.listSchedulingNotifications();
        setNotifications(next);
        if (username) await writeCalendarSchedulingInbox(username, next);
        return true;
      } catch {
        if (username) {
          setNotifications(await readCalendarSchedulingInbox(username));
        }
        return false;
      }
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [operations, username]);

  /** Resolves false when a fetch already in flight (sent earlier) was skipped. */
  const refreshIfIdle = useCallback(async (): Promise<boolean> => {
    if (refreshInFlightRef.current) return false;
    return refresh();
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!operations?.listSchedulingNotifications) return;
    if (typeof window === "undefined") return;

    let cancelled = false;

    const runSilentRefresh = () => {
      if (cancelled || busy) return;
      if (typeof document !== "undefined" && document.hidden) return;
      void refreshIfIdle().catch(() => undefined);
    };

    // Invitations keep their own interval, slower while push is connected (#2287);
    // a pushed `CalendarEvent` state refreshes them (below), as delivering an
    // invitation writes the invitee's event copy.
    const intervalId = window.setInterval(
      runSilentRefresh,
      pushConnected ? CALENDAR_PUSH_POLL_MS : CALENDAR_BACKGROUND_POLL_MS,
    );
    const onVisibilityChange = () => {
      if (!document.hidden) runSilentRefresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [busy, operations?.listSchedulingNotifications, pushConnected, refreshIfIdle]);

  useJmapStateChange(["CalendarEvent"], () => {
    if (!operations?.listSchedulingNotifications || busy) return;
    if (typeof document !== "undefined" && document.hidden) return;
    // Hidden, busy and missing-list exits stay void: the visibility handler and
    // `respond` refresh later, and `false` would pin `CalendarEvent` unconfirmed.
    return refreshIfIdle().catch(() => false);
  });

  const dropNotifications = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setNotifications((current) => current.filter((row) => !ids.includes(row.id)));
  }, []);

  useEffect(() => {
    setCalendarsSchedulingConflictListener((ids) => {
      // Every outbox flush reports, so an empty list means "no conflicts".
      if (ids.length === 0) return;
      dropNotifications(ids);
      options?.onSchedulingConflict?.(ids);
    });
    return () => setCalendarsSchedulingConflictListener(undefined);
  }, [dropNotifications, options?.onSchedulingConflict]);

  const respond = useCallback(
    async (
      id: string,
      status: CalendarSchedulingRespondStatus,
      respondOptions?: CalendarSchedulingRespondOptions,
    ) => {
      if (!operations?.respondSchedulingNotification) return;
      setBusy(true);
      try {
        await operations.respondSchedulingNotification(id, status, respondOptions);
        const next = (current: CalendarSchedulingNotification[]) =>
          current.map((row) => (row.id === id ? { ...row, participationStatus: status } : row));
        setNotifications(next);
        if (username) {
          const cached = await readCalendarSchedulingInbox(username);
          await writeCalendarSchedulingInbox(username, next(cached));
        }
        if (readBrowserOnline()) {
          await refresh();
        }
        options?.onResponded?.();
      } catch (error) {
        if (error instanceof CalendarSchedulingGoneError) {
          dropNotifications([id]);
        }
        options?.onError?.(error);
        throw error;
      } finally {
        setBusy(false);
      }
    },
    [dropNotifications, operations, options?.onError, options?.onResponded, refresh, username],
  );

  const dismiss = useCallback(
    async (id: string) => {
      if (!operations?.dismissSchedulingNotification) return;
      setBusy(true);
      try {
        await operations.dismissSchedulingNotification(id);
        setNotifications((current) => current.filter((row) => row.id !== id));
        if (username) {
          const cached = await readCalendarSchedulingInbox(username);
          await writeCalendarSchedulingInbox(
            username,
            cached.filter((row) => row.id !== id),
          );
        }
      } finally {
        setBusy(false);
      }
    },
    [operations, username],
  );

  return {
    notifications,
    invitees,
    canSubmitEmail,
    busy,
    respond,
    dismiss,
    refresh,
    refreshIfIdle,
  };
}
