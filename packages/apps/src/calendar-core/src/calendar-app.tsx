import { useMemo } from "react";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarApiSource } from "@/calendar-core/src/calendar-api-source";
import { CalendarWorkspace } from "@/calendar-core/src/calendar-workspace";
import { useCalendarAPI } from "@/calendar-core/src/use-calendar-api";
import { useCalendarRouteSync } from "@/calendar-core/src/use-calendar-route-sync";
import { useCalendarSurface } from "@/calendar-core/src/use-calendar-surface";

export type CalendarAppProps = {
  apiSource?: CalendarApiSource;
};

export function CalendarApp({ apiSource }: CalendarAppProps = {}) {
  const { initialView, initialPresentation, initialAnchor, handleRouteStateChange } =
    useCalendarRouteSync();
  const {
    phase,
    error,
    retry,
    successVersion,
    data,
    session,
    operations,
    jmapClient,
    refreshBootstrap,
  } = useCalendarAPI(apiSource);

  const surface = useCalendarSurface(jmapClient, data, session.user.email, {
    onPersisted: () => {
      void refreshBootstrap();
    },
  });
  const syncedSurface = useMemo(
    () => ({
      ...surface,
      syncNow: () => {
        surface.syncNow();
        void refreshBootstrap();
      },
    }),
    [surface, refreshBootstrap],
  );

  return (
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
          initialView={initialView}
          initialPresentation={initialPresentation}
          initialAnchor={initialAnchor}
          onRouteStateChange={handleRouteStateChange}
          onLogout={() => {
            window.location.assign("/logout");
          }}
        />
      )}
    />
  );
}
