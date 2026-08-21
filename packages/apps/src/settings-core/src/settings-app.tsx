import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import { resolveWgwSameOriginHref } from "@/lib/api/wgw/route-guard";
import type { SettingsApiSource } from "@/settings-core/src/settings-api-source";
import { useSettingsAPI } from "@/settings-core/src/use-settings-api";
import { SettingsWorkspace } from "@/settings-core/src/settings-workspace";

export type SettingsAppProps = {
  /** When set (e.g. Storybook live story), bypasses `wgwLiveApiEnabled()` routing. */
  apiSource?: SettingsApiSource;
};

export function SettingsApp({ apiSource }: SettingsAppProps = {}) {
  const { phase, error, retry, successVersion, listLoading, session, data, operations } =
    useSettingsAPI(apiSource);

  return (
    <WorkspaceLiveAppShell
      phase={phase}
      error={error}
      retry={retry}
      errorTitle="Could not load settings"
      successVersion={successVersion}
      render={(key) => (
        <SettingsWorkspace
          key={key}
          data={data}
          session={session}
          operations={operations}
          listLoading={listLoading}
          onLogout={() => {
            window.location.assign(resolveWgwSameOriginHref(data.logoutUrl, "/logout"));
          }}
        />
      )}
    />
  );
}
