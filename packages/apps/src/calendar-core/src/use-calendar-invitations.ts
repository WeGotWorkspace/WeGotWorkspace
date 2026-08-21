import { useCallback, useEffect, useRef, useState } from "react";
import { CALENDAR_BACKGROUND_POLL_MS } from "@/calendar-core/src/calendar-refresh";
import type { CalendarAPIOperations } from "@/calendar-core/src/calendar-types";
import type { CalendarInvitee } from "@/calendar-core/src/calendar-attendees";
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
} from "@/lib/offline/calendars-scheduling-offline-store";
import { setCalendarsSchedulingConflictListener } from "@/lib/offline/calendars-sync-conflicts";
import { resolveCalendarsOfflineUsername } from "@/lib/offline/offline-session";

export type UseCalendarInvitationsOptions = {
  username?: string;
  onResponded?: () => void;
  onError?: (error: unknown) => void;
  onSchedulingConflict?: (notificationIds: string[]) => void;
};

function cacheUsername(sessionUsername?: string): string | null {
  return resolveCalendarsOfflineUsername(sessionUsername);
}

export function useCalendarInvitations(
  operations?: CalendarAPIOperations,
  options?: UseCalendarInvitationsOptions,
) {
  const [notifications, setNotifications] = useState<CalendarSchedulingNotification[]>([]);
  const [invitees, setInvitees] = useState<CalendarInvitee[]>([]);
  const [canSubmitEmail, setCanSubmitEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const refreshInFlightRef = useRef(false);
  const username = cacheUsername(options?.username);

  const refresh = useCallback(async () => {
    if (!operations?.listSchedulingNotifications) {
      if (username) {
        const cached = await readCalendarSchedulingInbox(username);
        setNotifications(cached);
      } else {
        setNotifications([]);
      }
      return;
    }
    refreshInFlightRef.current = true;
    try {
      if (!readBrowserOnline()) {
        if (username) {
          setNotifications(await readCalendarSchedulingInbox(username));
        }
        return;
      }
      try {
        const next = await operations.listSchedulingNotifications();
        setNotifications(next);
        if (username) await writeCalendarSchedulingInbox(username, next);
      } catch {
        if (username) {
          setNotifications(await readCalendarSchedulingInbox(username));
        }
      }
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [operations, username]);

  const refreshIfIdle = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    await refresh();
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  useEffect(() => {
    if (!operations?.listSchedulingNotifications) return;
    if (typeof window === "undefined") return;

    let cancelled = false;

    const runSilentRefresh = () => {
      if (cancelled || busy) return;
      if (typeof document !== "undefined" && document.hidden) return;
      void refreshIfIdle().catch(() => undefined);
    };

    const intervalId = window.setInterval(runSilentRefresh, CALENDAR_BACKGROUND_POLL_MS);
    const onVisibilityChange = () => {
      if (!document.hidden) runSilentRefresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [busy, operations?.listSchedulingNotifications, refreshIfIdle]);

  const dropNotifications = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setNotifications((current) => current.filter((row) => !ids.includes(row.id)));
  }, []);

  useEffect(() => {
    setCalendarsSchedulingConflictListener((ids) => {
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
