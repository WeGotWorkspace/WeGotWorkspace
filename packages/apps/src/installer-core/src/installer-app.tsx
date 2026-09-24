import { buildWgwLoginHref } from "@/lib/api/wgw/route-guard";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import type { InstallerApiSource } from "@/installer-core/src/installer-api-source";
import { InstallerWorkspace } from "@/installer-core/src/installer-workspace";
import { useInstallerAPI } from "@/installer-core/src/use-installer-api";

export type InstallerAppProps = {
  /** When set (e.g. Storybook live story), bypasses `wgwLiveApiEnabled()` routing. */
  apiSource?: InstallerApiSource;
};

export function InstallerApp({ apiSource }: InstallerAppProps = {}) {
  const { phase, error, retry, successVersion, data, operations } = useInstallerAPI(apiSource);

  return (
    <WorkspaceLiveAppShell
      phase={phase}
      error={error}
      retry={retry}
      errorTitle="Could not load installer"
      successVersion={successVersion}
      render={(key) => (
        <InstallerWorkspace
          key={key}
          data={data}
          operations={operations}
          onOpenWorkspace={() => {
            if (typeof window !== "undefined") {
              window.location.assign(buildWgwLoginHref("/"));
            }
          }}
        />
      )}
    />
  );
}
