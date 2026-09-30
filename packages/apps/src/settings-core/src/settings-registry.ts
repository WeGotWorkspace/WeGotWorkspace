import type { ReactNode } from "react";
import type { WorkspaceAppId } from "@/lib/workspace-app-icons";
import type { SettingsReachabilityContext } from "@/settings-core/src/settings-reachability";
import type {
  SettingsGroup,
  SettingsPanelGroup,
  SettingsPanelId,
} from "@/settings-core/src/settings-types";
import type { SettingsMailFormController } from "@/settings-core/src/use-settings-mail-form";
import type { SettingsMcpGrantsState } from "@/settings-core/src/use-settings-mcp-grants";
import type { SettingsProfileFormController } from "@/settings-core/src/use-settings-profile-form";

export type SettingsSliceRenderProps = {
  profile: SettingsProfileFormController;
  mail: SettingsMailFormController;
  assistants: SettingsMcpGrantsState;
  memberships: SettingsGroup[];
};

export type SettingsSlice = {
  id: string;
  panelIds: SettingsPanelId[];
  reachable?: (ctx: SettingsReachabilityContext) => boolean;
  render: (props: SettingsSliceRenderProps) => ReactNode;
};

export type SettingsPanel = {
  id: SettingsPanelId;
  label: string;
  description: string;
  icon: ReactNode;
  group: SettingsPanelGroup;
  appId?: WorkspaceAppId;
  reachable?: (ctx: SettingsReachabilityContext) => boolean;
  /** Profile, memberships, and assistants read the Settings API. Local panes skip it. */
  needsSettingsApi?: boolean;
  /** When false, omit from Settings sidebar. Footer still uses `appId` when set. */
  showInNav?: boolean;
};

const panels = new Map<SettingsPanelId, SettingsPanel>();
const slices = new Map<string, SettingsSlice>();
let builtinRegistered = false;

function sliceIsReachable(slice: SettingsSlice, ctx: SettingsReachabilityContext): boolean {
  return slice.reachable == null || slice.reachable(ctx);
}

function panelGatePasses(panel: SettingsPanel, ctx: SettingsReachabilityContext): boolean {
  return panel.reachable == null || panel.reachable(ctx);
}

export function panelIsVisible(panel: SettingsPanel, ctx: SettingsReachabilityContext): boolean {
  return panelGatePasses(panel, ctx) && slicesFor(panel.id, ctx).length > 0;
}

export function markBuiltinSettingsRegistered(): boolean {
  if (builtinRegistered) return false;
  builtinRegistered = true;
  return true;
}

export function registerPanel(panel: SettingsPanel): void {
  if (panels.has(panel.id)) {
    throw new Error(`Settings panel "${panel.id}" is already registered`);
  }
  panels.set(panel.id, panel);
}

export function registerSlice(slice: SettingsSlice): void {
  if (slices.has(slice.id)) {
    throw new Error(`Settings slice "${slice.id}" is already registered`);
  }
  slices.set(slice.id, slice);
}

export function getSettingsPanel(id: SettingsPanelId): SettingsPanel | undefined {
  return panels.get(id);
}

export function isSettingsPanelId(id: string): boolean {
  return panels.has(id);
}

export function slicesFor(
  panelId: SettingsPanelId,
  ctx: SettingsReachabilityContext,
): SettingsSlice[] {
  return [...slices.values()].filter(
    (slice) => slice.panelIds.includes(panelId) && sliceIsReachable(slice, ctx),
  );
}

export function panelsForNav(ctx: SettingsReachabilityContext): SettingsPanel[] {
  return [...panels.values()].filter(
    (panel) => panel.showInNav !== false && panelIsVisible(panel, ctx),
  );
}

export function panelForApp(
  appId: WorkspaceAppId,
  ctx: SettingsReachabilityContext,
): SettingsPanel | undefined {
  return [...panels.values()].find((panel) => panel.appId === appId && panelIsVisible(panel, ctx));
}

export function resetSettingsRegistryForTests(): void {
  panels.clear();
  slices.clear();
  builtinRegistered = false;
}
