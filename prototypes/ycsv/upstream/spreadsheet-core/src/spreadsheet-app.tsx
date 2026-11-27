import { useCallback, useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import {
  parseSpreadsheetRouteSearch,
  spreadsheetApiPathFromSearch,
  spreadsheetSearchFromApiPath,
} from "@/spreadsheet-core/src/spreadsheet-route-search";
import type { SpreadsheetAppProps } from "@/spreadsheet-core/src/spreadsheet-app-props";
import { SpreadsheetWorkspace } from "@/spreadsheet-core/src/spreadsheet-workspace";
import { useSpreadsheetAPI } from "@/spreadsheet-core/src/use-spreadsheet-api";

export function SpreadsheetApp({ apiSource }: SpreadsheetAppProps = {}) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const { phase, error, retry, successVersion, session, data, operations } =
    useSpreadsheetAPI(apiSource);

  const filePath = useMemo(
    () =>
      spreadsheetApiPathFromSearch(
        parseSpreadsheetRouteSearch(search as Record<string, unknown>).file,
      ),
    [search],
  );

  const handleLogout = useCallback(() => {
    window.location.assign("/logout");
  }, []);

  const handleFileRenamed = useCallback(
    (apiPath: string) => {
      void navigate({ to: "/sheets", search: spreadsheetSearchFromApiPath(apiPath) });
    },
    [navigate],
  );

  return (
    <WorkspaceLiveAppShell
      phase={phase}
      error={error}
      retry={retry}
      errorTitle="Could not load sheets"
      successVersion={successVersion}
      render={(key) => (
        <SpreadsheetWorkspace
          key={key}
          data={data}
          session={session}
          operations={operations}
          filePath={filePath}
          onLogout={handleLogout}
          onFileRenamed={handleFileRenamed}
        />
      )}
    />
  );
}
