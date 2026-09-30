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

/** Sampled from launcher tile artwork. PWA window chrome uses `WORKSPACE_PWA_THEME_COLOR`. */
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

/**
 * Canonical vector artwork for in-app UI — `/app-icons/{app}.svg`.
 * Install manifests do not use this file. WebKit prefers apple-touch-icon when
 * it is in the document head, and otherwise reads the generated PNGs. The SVG
 * fills use `var(--wai-*)`, which are unreliable in an external image.
 */
export function workspaceAppIconUiSrc(appId: WorkspaceAppId): string {
  return `/app-icons/${appId}.svg`;
}

/**
 * Historical alias of {@link workspaceAppIconUiSrc}. Install manifests use the
 * PNGs from `generate-pwa-icons.mjs`, not this path.
 */
export function workspaceAppIconManifestSrc(appId: WorkspaceAppId): string {
  return workspaceAppIconUiSrc(appId);
}

/**
 * 180×180 PNG for `<link rel="apple-touch-icon">`, from `generate-pwa-icons.mjs`.
 * WebKit uses that link when it is in the document head. This shell injects it
 * from the router, so a client that only reads the raw HTML still depends on
 * the manifest PNGs.
 */
export function workspaceAppIconAppleTouchSrc(appId: WorkspaceAppId): string {
  return `/pwa-icons/${appId}-${APPLE_TOUCH_SIZE}.png`;
}

/**
 * In-app suite mark — `/app-icons/home.svg`.
 * Navy + cream artwork for the home grid and switch trigger. The `/` install
 * icons and favicon use `/app-icons/home-pwa.svg`.
 */
export function workspaceHomeIconUiSrc(): string {
  return "/app-icons/home.svg";
}

/** Suite / Meet dark-surface accent — keep in sync with `--workspace-home-bg`. */
export const WORKSPACE_HOME_ACCENT = "#1B1D3A";

/**
 * @deprecated Prefer `workspaceAppIconUiSrc` (in-app SVG) or `workspaceAppIconAppleTouchSrc` (180 PNG).
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
