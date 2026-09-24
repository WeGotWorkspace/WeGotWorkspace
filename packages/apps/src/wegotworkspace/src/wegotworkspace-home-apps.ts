import type { AppsHomeScreenItem } from "@/apps-home-screen/src/apps-home-screen";
import {
  APP_SWITCH_PRODUCT_APPS,
  appSwitchUtilityApps,
  type AppSwitchMenuApp,
} from "@/app-switch-button/src/app-switch-menu-apps";
import { WORKSPACE_APP_ACCENT, type WorkspaceAppId } from "@/lib/workspace-app-icons";

/** Light tile accents that keep white glyph / label contrast on the home grid. */
const HOME_TILE_FG_WHITE = new Set<WorkspaceAppId>([
  "calendar",
  "contacts",
  "tasks",
  "drive",
  "docs",
  "meet",
  "admin",
]);

export type WorkspaceHomeAppVisibility = {
  showCalendar?: boolean;
  showContacts?: boolean;
  showTasks?: boolean;
  showAdmin?: boolean;
};

export function homeAppTile(
  appId: WorkspaceAppId,
  label: string,
  onSelect: () => void,
  fg?: string,
): AppsHomeScreenItem {
  return {
    id: appId,
    label,
    appId,
    accent: WORKSPACE_APP_ACCENT[appId],
    fg,
    onSelect,
  };
}

function productVisible(appId: WorkspaceAppId, visibility: WorkspaceHomeAppVisibility): boolean {
  if (appId === "calendar") return visibility.showCalendar !== false;
  if (appId === "contacts") return visibility.showContacts !== false;
  if (appId === "tasks") return visibility.showTasks !== false;
  return true;
}

function tileFromMenuApp(
  app: AppSwitchMenuApp,
  onSelect: (app: AppSwitchMenuApp) => void,
): AppsHomeScreenItem {
  return homeAppTile(
    app.id,
    app.label,
    () => onSelect(app),
    HOME_TILE_FG_WHITE.has(app.id) ? "#ffffff" : undefined,
  );
}

/**
 * Home/dashboard tiles in the same order as {@link orderedAppSwitchApps}:
 * product apps A–Z, optional extras (e.g. plugins), then Admin / Settings.
 */
export function orderedWorkspaceHomeApps(
  onSelect: (app: AppSwitchMenuApp) => void,
  visibility: WorkspaceHomeAppVisibility = {},
  extraProductTiles: AppsHomeScreenItem[] = [],
): AppsHomeScreenItem[] {
  const showAdmin = visibility.showAdmin !== false;
  const products = APP_SWITCH_PRODUCT_APPS.filter((app) => productVisible(app.id, visibility)).map(
    (app) => tileFromMenuApp(app, onSelect),
  );

  const extras = [...extraProductTiles].sort((a, b) => a.label.localeCompare(b.label));
  const utilities = appSwitchUtilityApps(showAdmin).map((app) => tileFromMenuApp(app, onSelect));

  return [...products, ...extras, ...utilities];
}
