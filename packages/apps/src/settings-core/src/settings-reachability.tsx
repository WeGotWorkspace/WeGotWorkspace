import { createContext, useContext, type ReactNode } from "react";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type { SettingsUIData } from "@/settings-core/src/settings-types";

/**
 * Named reachability facts for panel and slice gates.
 * Gate bodies always use `flag === true` — a missing field hides the gated item.
 * New flags are optional fields on this type and on the shell builder.
 */
export type SettingsReachabilityContext = {
  /** Admin MCP kill-switch. Settings nav supplies this; the shell omits it. */
  mcpEnabled?: boolean;
  session?: WorkspaceSession;
};

const SettingsReachabilityReactContext = createContext<SettingsReachabilityContext>({});

export function reachabilityFromShell(input: {
  session?: WorkspaceSession;
}): SettingsReachabilityContext {
  return { session: input.session };
}

export function reachabilityFromSettingsData(
  data: Pick<SettingsUIData, "mcpEnabled">,
): SettingsReachabilityContext {
  return { mcpEnabled: data.mcpEnabled };
}

export function SettingsReachabilityProvider({
  value,
  children,
}: {
  value: SettingsReachabilityContext;
  children: ReactNode;
}): ReactNode {
  return (
    <SettingsReachabilityReactContext.Provider value={value}>
      {children}
    </SettingsReachabilityReactContext.Provider>
  );
}

export function useSettingsReachability(): SettingsReachabilityContext {
  return useContext(SettingsReachabilityReactContext);
}
