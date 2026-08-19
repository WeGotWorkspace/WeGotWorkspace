import { useCallback, useEffect, useRef, useState } from "react";
import { CALENDAR_BACKGROUND_POLL_MS } from "@/calendar-core/src/calendar-refresh";
import type { CalendarAPIOperations } from "@/calendar-core/src/calendar-types";
import type { CalendarInvitee } from "@/calendar-core/src/calendar-attendees";
import type {
  CalendarSchedulingNotification,
  CalendarSchedulingRespondStatus,
} from "@/lib/api/wgw/calendar-scheduling";

export function useCalendarInvitations(
  operations?: CalendarAPIOperations,
  options?: { onResponded?: () => void },
) {
  const [notifications, setNotifications] = useState<CalendarSchedulingNotification[]>([]);
  const [invitees, setInvitees] = useState<CalendarInvitee[]>([]);
  const [canSubmitEmail, setCanSubmitEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const refreshInFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!operations?.listSchedulingNotifications) {
      setNotifications([]);
      return;
    }
    refreshInFlightRef.current = true;
    try {
      const next = await operations.listSchedulingNotifications();
      setNotifications(next);
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [operations]);

  const refreshIfIdle = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    await refresh();
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!operations?.listInvitees) {
      setInvitees([]);
      setCanSubmitEmail(false);
      return;
    }
    void operations.listInvitees().then((next) => {
      setInvitees(next.list);
      setCanSubmitEmail(next.canSubmitEmail);
    });
  }, [operations]);

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

  const respond = useCallback(
    async (id: string, status: CalendarSchedulingRespondStatus, calendarId?: string) => {
      if (!operations?.respondSchedulingNotification) return;
      setBusy(true);
      try {
        await operations.respondSchedulingNotification(id, status, calendarId);
        setNotifications((current) =>
          current.map((row) => (row.id === id ? { ...row, participationStatus: status } : row)),
        );
        await refresh();
        options?.onResponded?.();
      } finally {
        setBusy(false);
      }
    },
    [operations, options?.onResponded, refresh],
  );

  const dismiss = useCallback(
    async (id: string) => {
      if (!operations?.dismissSchedulingNotification) return;
      setBusy(true);
      try {
        await operations.dismissSchedulingNotification(id);
        setNotifications((current) => current.filter((row) => row.id !== id));
      } finally {
        setBusy(false);
      }
    },
    [operations],
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
