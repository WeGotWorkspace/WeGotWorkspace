import { useCallback, useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import { wgwCompleteLogoutNavigation, wgwIsGuestSession } from "@/lib/api/wgw/http";
import {
  driveSearchFromView,
  driveViewFromSearch,
  parseDriveRouteSearch,
} from "@/drive-core/src/drive-route-search";
import { driveCurrentUsername } from "@/drive-core/src/use-drive-shell";
import type { ViewKey } from "@/lib/files/drive-models";
import { useDriveAPI } from "@/drive-core/src/use-drive-api";
import { DriveWorkspace } from "@/drive-core/src/drive-workspace";
import type { DriveAppProps } from "@/drive-core/src/drive-app-props";
import { useNoDocsHandoff } from "@/drive-core/src/drive-docs-handoff";

export function DriveApp({ apiSource, useDocsHandoff = useNoDocsHandoff }: DriveAppProps = {}) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const {
    phase,
    error,
    retry,
    successVersion,
    listLoading,
    session,
    data,
    operations,
    shareOperations,
    offlineUsername,
  } = useDriveAPI(apiSource);

  const routeView = useMemo(
    () => driveViewFromSearch(parseDriveRouteSearch(search as Record<string, unknown>)),
    [search],
  );

  const handleViewChange = useCallback(
    (view: ViewKey) => {
      void navigate({
        to: "/drive",
        search: driveSearchFromView(view),
      });
    },
    [navigate],
  );

  // Docs fills this slot (open in Docs, Save as Markdown), so Drive does not
  // import Docs. The workspace adds its own "can create files here" gate.
  const { onOpenDocsFile, saveAsMarkdown } = useDocsHandoff({
    enabled: !wgwIsGuestSession(),
    username: driveCurrentUsername(data, session),
    dialogSurfaceClassName: "drive-dialog-surface",
  });

  return (
    <WorkspaceLiveAppShell
      phase={phase}
      error={error}
      retry={retry}
      errorTitle="Could not load drive"
      successVersion={successVersion}
      render={(key) => (
        <DriveWorkspace
          key={key}
          data={data}
          session={session}
          operations={operations}
          shareOperations={shareOperations}
          listLoading={listLoading}
          offlineUsername={offlineUsername}
          view={routeView}
          onViewChange={handleViewChange}
          onOpenDocsFile={onOpenDocsFile}
          saveAsMarkdown={saveAsMarkdown}
          onLogout={() => {
            if (wgwIsGuestSession()) {
              void wgwCompleteLogoutNavigation();
              return;
            }
            window.location.assign("/logout");
          }}
        />
      )}
    />
  );
}
