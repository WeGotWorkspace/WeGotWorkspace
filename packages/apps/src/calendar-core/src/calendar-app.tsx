import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarApiSource } from "@/calendar-core/src/calendar-api-source";
import { CalendarWorkspace } from "@/calendar-core/src/calendar-workspace";
import { useCalendarAPI } from "@/calendar-core/src/use-calendar-api";
import { useCalendarSurface } from "@/calendar-core/src/use-calendar-surface";

export type CalendarAppProps = {
  apiSource?: CalendarApiSource;
};

export function CalendarApp({ apiSource }: CalendarAppProps = {}) {
  const {
    phase,
    error,
    retry,
    successVersion,
    listRefreshing,
    refreshList,
    data,
    session,
    operations,
    jmapClient,
  } = useCalendarAPI(apiSource);

  const surface = useCalendarSurface(jmapClient, data);

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
          surface={surface}
          listRefreshing={listRefreshing}
          onRefreshList={refreshList}
          onLogout={() => {
            window.location.assign("/logout");
          }}
        />
      )}
    />
  );
}
