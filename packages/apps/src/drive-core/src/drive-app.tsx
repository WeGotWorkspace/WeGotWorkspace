import { useCallback, useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import { wgwCompleteLogoutNavigation, wgwIsGuestSession } from "@/lib/api/wgw/http";
import {
  driveSearchFromView,
  driveViewFromSearch,
  parseDriveRouteSearch,
} from "@/drive-core/src/drive-route-search";
import { useOpenDocsFile } from "@/docs-core/src/use-open-docs-file";
import { useSaveAsMarkdownAction } from "@/docs-core/src/docx-import/use-save-as-markdown-action";
import { driveCurrentUsername } from "@/drive-core/src/use-drive-shell";
import type { ViewKey } from "@/lib/files/drive-models";
import { useDriveAPI } from "@/drive-core/src/use-drive-api";
import { DriveWorkspace } from "@/drive-core/src/drive-workspace";
import type { DriveAppProps } from "@/drive-core/src/drive-app-props";

export function DriveApp({ apiSource }: DriveAppProps = {}) {
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

  const handleOpenDocsFile = useOpenDocsFile();
  // Docs' Save as Markdown, wired here so the workspace does not import Docs.
  // The workspace adds its own "can create files here" gate.
  const saveAsMarkdown = useSaveAsMarkdownAction({
    enabled: !wgwIsGuestSession(),
    onOpenDocsFile: handleOpenDocsFile,
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
          onOpenDocsFile={handleOpenDocsFile}
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
