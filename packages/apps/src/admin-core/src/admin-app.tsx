import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import { resolveWgwSameOriginHref } from "@/lib/api/wgw/route-guard";
import { useAdminAPI } from "@/admin-core/src/use-admin-api";
import { useAdminRouteSync } from "@/admin-core/src/use-admin-route-sync";
import { AdminWorkspace } from "@/admin-core/src/admin-workspace";

export function AdminApp() {
  const { phase, error, retry, successVersion, listLoading, session, data, operations } =
    useAdminAPI();
  const { section, onSectionChange } = useAdminRouteSync();

  return (
    <WorkspaceLiveAppShell
      phase={phase}
      error={error}
      retry={retry}
      errorTitle="Could not load admin state"
      successVersion={successVersion}
      render={(key) => (
        <AdminWorkspace
          key={key}
          data={data}
          session={session}
          operations={operations}
          listLoading={listLoading}
          section={section}
          onSectionChange={onSectionChange}
          onLogout={() => {
            window.location.assign(resolveWgwSameOriginHref(data.logoutUrl, "/logout"));
          }}
        />
      )}
    />
  );
}
