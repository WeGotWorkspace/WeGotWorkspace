/** Workspace product ids that have branded launcher / PWA icons under `/app-icons/`. */
export const WORKSPACE_APP_IDS = [
  "notes",
  "mail",
  "contacts",
  "tasks",
  "drive",
  "docs",
  "settings",
  "meet",
  "admin",
] as const;

export type WorkspaceAppId = (typeof WORKSPACE_APP_IDS)[number];

/**
 * Future app icons stored under `/app-icons/` but not wired in the home grid or switcher yet.
 * Source artwork: calendar, reminders, tasks (vector SVG in `src/assets/app-icons/`).
 */
export const WORKSPACE_FUTURE_APP_ICON_IDS = ["calendar", "reminders"] as const;

/** Sampled from icon artwork — keep in sync with webmanifest theme colors. */
export const WORKSPACE_APP_ACCENT: Record<WorkspaceAppId, string> = {
  notes: "#f6d176",
  mail: "#ef4444",
  contacts: "#8B6F45",
  tasks: "#ea8c72",
  drive: "#10b981",
  docs: "#3b82f6",
  settings: "#64748b",
  meet: "#06b6d4",
  admin: "#475569",
};

const APPLE_TOUCH_SIZE = 180;

/** Canonical vector artwork for UI and web app manifests — `/app-icons/{app}.svg`. */
export function workspaceAppIconUiSrc(appId: WorkspaceAppId): string {
  return `/app-icons/${appId}.svg`;
}

/** Alias for manifest / install surfaces that reference the same vector asset as UI. */
export function workspaceAppIconManifestSrc(appId: WorkspaceAppId): string {
  return workspaceAppIconUiSrc(appId);
}

/** 180×180 PNG for iOS `<link rel="apple-touch-icon">` only — generated via `generate-pwa-icons.mjs`. */
export function workspaceAppIconAppleTouchSrc(appId: WorkspaceAppId): string {
  return `/pwa-icons/${appId}-${APPLE_TOUCH_SIZE}.png`;
}

/** Suite / workspace home shell icon — `/app-icons/home.svg` (not a workspace app tile). */
export function workspaceHomeIconUiSrc(): string {
  return "/app-icons/home.svg";
}

/** Sampled from home icon background — keep in sync with `home.webmanifest` and `--workspace-home-bg`. */
export const WORKSPACE_HOME_ACCENT = "#1B1D3A";

/**
 * @deprecated Prefer `workspaceAppIconManifestSrc` (SVG) or `workspaceAppIconAppleTouchSrc` (180 PNG).
 */
export function workspaceAppIconSrc(appId: WorkspaceAppId, size = APPLE_TOUCH_SIZE): string {
  return size === APPLE_TOUCH_SIZE
    ? workspaceAppIconAppleTouchSrc(appId)
    : workspaceAppIconManifestSrc(appId);
}

export function isWorkspaceAppId(value: string): value is WorkspaceAppId {
  return (WORKSPACE_APP_IDS as readonly string[]).includes(value);
}
