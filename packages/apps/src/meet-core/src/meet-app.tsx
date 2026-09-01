import { useCallback } from "react";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import type { MeetAppProps } from "@/meet-core/src/meet-app-props";
import { MeetCallWorkspace } from "@/meet-core/src/meet-call-workspace";
import { useMeetAPI } from "@/meet-core/src/use-meet-api";
import { useMeetRouteSync } from "@/meet-core/src/use-meet-route-sync";

export function MeetApp({ source }: MeetAppProps = {}) {
  const { phase, error, retry, successVersion, listLoading, data, session, operations } =
    useMeetAPI(source);
  const { invitedRoom, isJoinRoute, buildCallLink, onRoomChange } = useMeetRouteSync();

  const handleLogout = useCallback(() => {
    window.location.assign("/logout");
  }, []);

  return (
    <WorkspaceLiveAppShell
      phase={phase}
      error={error}
      retry={retry}
      errorTitle="Could not load live meet"
      successVersion={successVersion}
      render={(key) => (
        <MeetCallWorkspace
          key={key}
          data={data}
          session={session}
          operations={operations}
          listLoading={listLoading}
          invitedRoom={invitedRoom}
          isJoinRoute={isJoinRoute}
          buildCallLink={buildCallLink}
          onRoomChange={onRoomChange}
          onLogout={handleLogout}
        />
      )}
    />
  );
}
