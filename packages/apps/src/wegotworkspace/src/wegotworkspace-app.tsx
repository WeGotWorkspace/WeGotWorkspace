import { useMemo } from "react";
import { createBrowserHistory } from "@tanstack/react-router";
import { normalizeWgwApiBaseUrl } from "@/lib/api/wgw/wgw-api-runtime";
import { WgwApiRuntimeProvider } from "@/lib/api/wgw/wgw-api-runtime-provider";
import { MeetCallProvider } from "@/meet-core/src/meet-call-provider";
import { PresenceProvider } from "@/presence-core/src/presence-provider";
import { WeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-router";

export function resolveProductionApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_WGW_API_BASE_URL as string | undefined;
  if (fromEnv?.trim()) {
    return normalizeWgwApiBaseUrl(fromEnv);
  }
  return "/api/v1";
}

/**
 * Production WeGotWorkspace client: browser history, live API, all product apps.
 */
export function WeGotWorkspaceApp() {
  const apiBaseUrl = useMemo(() => resolveProductionApiBaseUrl(), []);
  const history = useMemo(() => createBrowserHistory(), []);

  return (
    <WgwApiRuntimeProvider apiBaseUrl={apiBaseUrl}>
      {/* Above the router: the Meet call store survives route changes. */}
      <MeetCallProvider>
        {/* Live-only: workspace presence mesh for authenticated members. */}
        <PresenceProvider>
          <WeGotWorkspaceRouter mode="live" history={history} />
        </PresenceProvider>
      </MeetCallProvider>
    </WgwApiRuntimeProvider>
  );
}
