import { useCallback, useMemo, useRef, useState } from "react";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import {
  resolveCalendarsConflictKeepLocal,
  resolveCalendarsConflictUseServer,
} from "@/lib/offline/calendars-conflict-resolution";
import { CalendarConflictDialog } from "@/calendar-core/src/calendar-conflict-dialog";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarApiSource } from "@/calendar-core/src/calendar-api-source";
import { CalendarWorkspace } from "@/calendar-core/src/calendar-workspace";
import { useCalendarAPI } from "@/calendar-core/src/use-calendar-api";
import {
  applyPendingSyncToEngineEvents,
  useCalendarPendingSync,
} from "@/calendar-core/src/use-calendar-pending-sync";
import { useCalendarRouteSync } from "@/calendar-core/src/use-calendar-route-sync";
import { useCalendarSurface } from "@/calendar-core/src/use-calendar-surface";
import { parseCalendarMeetHref } from "@/calendar-core/src/calendar-meet-link";
import { createWgwMeetOperations } from "@/lib/api/wgw/meet";

export type CalendarAppProps = {
  apiSource?: CalendarApiSource;
};

export function CalendarApp({ apiSource }: CalendarAppProps = {}) {
  const { initialView, initialPresentation, initialAnchor, handleRouteStateChange } =
    useCalendarRouteSync();
  const [conflictQueue, setConflictQueue] = useState<string[]>([]);
  const [resolvingConflict, setResolvingConflict] = useState(false);

  const meetOperations = useMemo(() => {
    const ops = createWgwMeetOperations();
    return {
      roomStatus: ops.roomStatus,
      reserveRoom: ops.reserveRoom,
      patchRoomExpiresAt: ops.patchRoomExpiresAt,
    };
  }, []);
  const workspaceOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const handleJoinMeeting = useCallback((href: string) => {
    const parsed = parseCalendarMeetHref(href, window.location.origin);
    if (parsed?.kind === "wgw") {
      window.location.assign(`/meet/guest?room=${encodeURIComponent(parsed.room)}`);
      return;
    }
    window.open(href, "_blank", "noopener,noreferrer");
  }, []);

  const handleSyncConflict = useCallback((eventIds: string[]) => {
    setConflictQueue((prev) => {
      const next = [...prev];
      for (const id of eventIds) {
        if (!next.includes(id)) next.push(id);
      }
      return next;
    });
  }, []);

  const {
    phase,
    error,
    retry,
    successVersion,
    bootstrapRevision,
    data,
    session,
    operations,
    offlineUsername,
    jmapClient,
    refreshBootstrap,
    reloadFromCache,
  } = useCalendarAPI(apiSource, { onSyncConflict: handleSyncConflict });

  const pendingEventIds = useCalendarPendingSync(offlineUsername, bootstrapRevision);
  const eventsRef = useRef(data.events);
  eventsRef.current = data.events;

  const surface = useCalendarSurface(jmapClient, data, session.user.email, {
    operations,
    username: offlineUsername,
    onPersisted: () => {
      void refreshBootstrap();
    },
    onInboundChange: () => {
      void reloadFromCache();
    },
  });
  const syncedSurface = useMemo(
    () => ({
      ...surface,
      events: applyPendingSyncToEngineEvents(surface.events, pendingEventIds),
      syncNow: () => {
        surface.syncNow();
        void refreshBootstrap();
      },
    }),
    [surface, refreshBootstrap, pendingEventIds],
  );

  const activeConflictId = conflictQueue[0] ?? null;
  const activeConflictEvent = activeConflictId
    ? eventsRef.current.find((event) => event.id === activeConflictId)
    : undefined;
  const activeConflictTitle =
    (typeof activeConflictEvent?.title === "string" && activeConflictEvent.title.trim()) ||
    activeConflictId ||
    "";

  const dismissActiveConflict = useCallback(() => {
    setConflictQueue((prev) => prev.slice(1));
  }, []);

  const resolveActiveConflict = useCallback(
    (mode: "local" | "server") => {
      if (!activeConflictId || !offlineUsername) {
        dismissActiveConflict();
        return;
      }
      const eventId = activeConflictId;
      const username = offlineUsername;
      setResolvingConflict(true);
      void (async () => {
        try {
          if (mode === "local") {
            await resolveCalendarsConflictKeepLocal(username, eventId);
          } else {
            await resolveCalendarsConflictUseServer(username, eventId);
          }
        } catch {
          // Resolution best-effort; refresh below re-reads the latest state.
        } finally {
          setResolvingConflict(false);
          dismissActiveConflict();
          void refreshBootstrap();
        }
      })();
    },
    [activeConflictId, offlineUsername, dismissActiveConflict, refreshBootstrap],
  );

  return (
    <>
      <WorkspaceLiveAppShell
        phase={phase}
        error={error}
        retry={retry}
        errorTitle={defaultCalendarLabels.appTitle}
        successVersion={successVersion}
        render={(key) => (
          <CalendarWorkspace
            key={key}
            data={data}
            session={session}
            operations={operations}
            surface={syncedSurface}
            pendingEventIds={pendingEventIds}
            initialView={initialView}
            initialPresentation={initialPresentation}
            initialAnchor={initialAnchor}
            onRouteStateChange={handleRouteStateChange}
            onLogout={() => {
              window.location.assign("/logout");
            }}
            meetOperations={meetOperations}
            workspaceOrigin={workspaceOrigin}
            onJoinMeeting={handleJoinMeeting}
          />
        )}
      />
      <CalendarConflictDialog
        open={activeConflictId !== null}
        eventTitle={activeConflictTitle}
        remainingCount={Math.max(conflictQueue.length - 1, 0)}
        busy={resolvingConflict}
        labels={defaultCalendarLabels}
        onKeepLocal={() => resolveActiveConflict("local")}
        onUseServer={() => resolveActiveConflict("server")}
        onOpenChange={(open) => {
          if (!open && !resolvingConflict) dismissActiveConflict();
        }}
      />
    </>
  );
}
