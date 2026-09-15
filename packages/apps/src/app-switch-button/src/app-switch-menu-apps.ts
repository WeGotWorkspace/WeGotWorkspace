import {
  WORKSPACE_APP_IDS,
  workspaceAppLabel,
  type WorkspaceAppId,
} from "@/lib/workspace-app-icons";

/** Chrome / account apps — listed below a divider, separate from product apps. */
export const APP_SWITCH_UTILITY_APP_IDS = new Set<WorkspaceAppId>(["admin", "settings"]);

export type AppSwitchMenuApp = {
  id: WorkspaceAppId;
  label: string;
  to: `/${WorkspaceAppId}`;
};

function byDisplayName(a: AppSwitchMenuApp, b: AppSwitchMenuApp): number {
  return a.label.localeCompare(b.label);
}

export const APP_SWITCH_WORKSPACE_APPS: AppSwitchMenuApp[] = WORKSPACE_APP_IDS.map((id) => ({
  id,
  label: workspaceAppLabel(id),
  to: `/${id}` as const,
}));

export const APP_SWITCH_PRODUCT_APPS = APP_SWITCH_WORKSPACE_APPS.filter(
  (app) => !APP_SWITCH_UTILITY_APP_IDS.has(app.id),
).sort(byDisplayName);

const APP_SWITCH_UTILITY_APPS_ALL = APP_SWITCH_WORKSPACE_APPS.filter((app) =>
  APP_SWITCH_UTILITY_APP_IDS.has(app.id),
).sort(byDisplayName);

/**
 * Utility row for the app switch menu. Admin is omitted when the user lacks
 * the same administrators-group capability used by the home grid.
 */
export function appSwitchUtilityApps(showAdmin: boolean): AppSwitchMenuApp[] {
  if (showAdmin) return APP_SWITCH_UTILITY_APPS_ALL;
  return APP_SWITCH_UTILITY_APPS_ALL.filter((app) => app.id !== "admin");
}
