/** Workspace product ids that have branded launcher / PWA icons under `/app-icons/`. */
export const WORKSPACE_APP_IDS = [
  "notes",
  "mail",
  "calendar",
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
 * Source artwork: reminders (vector SVG in `src/assets/app-icons/`).
 */
export const WORKSPACE_FUTURE_APP_ICON_IDS = ["reminders"] as const;

/** Sampled from icon artwork — keep in sync with webmanifest theme colors. */
export const WORKSPACE_APP_ACCENT: Record<WorkspaceAppId, string> = {
  notes: "#ffc800",
  mail: "#de4b0e",
  calendar: "#ffbdc2",
  contacts: "#962fa8",
  tasks: "#ffbdc2",
  drive: "#8ACE00",
  docs: "#0045ff",
  settings: "#003311",
  meet: "#ffc800",
  admin: "#003311",
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

/**
 * Suite launcher tile — `/app-icons/home.svg`.
 * Full-bleed navy + cream artwork for the `/` PWA. The switch trigger remaps it
 * to the cream lockup via `--wai-*`.
 */
export function workspaceHomeIconUiSrc(): string {
  return "/app-icons/home.svg";
}

/** Suite / Meet dark-surface accent — keep in sync with `home.webmanifest` and `--workspace-home-bg`. */
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

/** Capitalized product label for chrome (app switch, toasts) — `docs` → `Docs`. */
export function workspaceAppLabel(appId: WorkspaceAppId): string {
  return appId.charAt(0).toUpperCase() + appId.slice(1);
}

/**
 * Resolve the active suite app label from a pathname the same way
 * {@link AppSwitchButton} infers its subtitle from the route.
 * Falls back to `Workspace` on home / login / unknown paths.
 */
export function workspaceAppLabelFromPath(pathname: string): string {
  const match = WORKSPACE_APP_IDS.find(
    (id) => pathname === `/${id}` || pathname.startsWith(`/${id}/`),
  );
  return match ? workspaceAppLabel(match) : "Workspace";
}
