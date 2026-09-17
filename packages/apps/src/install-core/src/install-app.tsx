import { buildWgwLoginHref } from "@/lib/api/wgw/route-guard";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import type { InstallApiSource } from "@/install-core/src/install-api-source";
import { InstallFirstRunWorkspace } from "@/install-core/src/install-first-run-workspace";
import { useInstallAPI } from "@/install-core/src/use-install-api";

export type InstallAppProps = {
  /** When set (e.g. Storybook live story), bypasses `wgwLiveApiEnabled()` routing. */
  apiSource?: InstallApiSource;
};

export function InstallApp({ apiSource }: InstallAppProps = {}) {
  const { phase, error, retry, successVersion, data, operations } = useInstallAPI(apiSource);

  return (
    <WorkspaceLiveAppShell
      phase={phase}
      error={error}
      retry={retry}
      errorTitle="Could not load installer"
      successVersion={successVersion}
      render={(key) => (
        <InstallFirstRunWorkspace
          key={key}
          data={data}
          operations={operations}
          onOpenWorkspace={() => {
            if (typeof window !== "undefined") {
              window.location.assign(buildWgwLoginHref("/"));
            }
          }}
          onOpenServerSettings={() => {
            if (typeof window !== "undefined") {
              window.location.assign(buildWgwLoginHref("/admin"));
            }
          }}
        />
      )}
    />
  );
}
