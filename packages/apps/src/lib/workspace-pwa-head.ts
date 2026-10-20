import { createPwaHead } from "@/lib/pwa-head";
import pwaIconCacheVersion from "@/lib/pwa-icon-cache-version.json";
import {
  workspaceAppIconAppleTouchSrc,
  workspaceAppIconUiSrc,
  type WorkspaceAppId,
} from "@/lib/workspace-app-icons";

/**
 * Bump `version` in `pwa-icon-cache-version.json` when launcher or install
 * artwork changes, then re-run `scripts/generate-pwa-icons.mjs`. The generator
 * reads that JSON; do not keep a second copy of the number here.
 */
export const WORKSPACE_PWA_ICON_CACHE_VERSION = pwaIconCacheVersion.version;

/**
 * Installed window chrome per colour scheme: the sidebar surface
 * (`--scheme-sidebar-surface`), so the title bar reads as part of the page.
 * `index.html` and `syncDocumentTheme` write the `theme-color` meta from these;
 * keep the inline script's hexes in sync. Launcher tiles stay on
 * `WORKSPACE_APP_ACCENT`.
 */
export const WORKSPACE_PWA_THEME_COLORS = { light: "#fff5e9", dark: "#1c1c1c" } as const;

/**
 * Manifest `theme_color` / `background_color`. Manifests cannot vary by scheme,
 * so they carry the light surface until the page sets the meta.
 */
export const WORKSPACE_PWA_THEME_COLOR = WORKSPACE_PWA_THEME_COLORS.light;

/** Mail stays an app id for icons and mail-core. The live shell does not install its PWA. */
export type WorkspacePwaAppKey = Exclude<WorkspaceAppId, "mail"> | "home";

type WorkspacePwaMeta = {
  title: string;
  description: string;
  appTitle: string;
  manifest: string;
};

const WORKSPACE_PWA_META: Record<WorkspacePwaAppKey, WorkspacePwaMeta> = {
  home: {
    title: "WeGotWorkspace",
    description: "Sign in to WeGotWorkspace.",
    appTitle: "WeGotWorkspace",
    manifest: "/manifests/home.webmanifest",
  },
  notes: {
    title: "Notes",
    description: "A quiet, editorial workspace for your writing.",
    appTitle: "Notes",
    manifest: "/manifests/notes.webmanifest",
  },
  drive: {
    title: "Drive",
    description: "Files and folders, organized.",
    appTitle: "Drive",
    manifest: "/manifests/drive.webmanifest",
  },
  docs: {
    title: "Docs",
    description: "Documents and collaborative editing.",
    appTitle: "Docs",
    manifest: "/manifests/docs.webmanifest",
  },
  calendar: {
    title: "Calendar",
    description: "Your schedule — month, week, and day views.",
    appTitle: "Calendar",
    manifest: "/manifests/calendar.webmanifest",
  },
  contacts: {
    title: "Contacts",
    description: "People and groups in your workspace.",
    appTitle: "Contacts",
    manifest: "/manifests/contacts.webmanifest",
  },
  tasks: {
    title: "Tasks",
    description: "A calm to-do workspace for focused work.",
    appTitle: "Tasks",
    manifest: "/manifests/tasks.webmanifest",
  },
  settings: {
    title: "Settings",
    description: "Manage your account, memberships, and mail.",
    appTitle: "Settings",
    manifest: "/manifests/settings.webmanifest",
  },
  meet: {
    title: "Meet",
    description: "Video conferencing for up to 4 people.",
    appTitle: "Meet",
    manifest: "/manifests/meet.webmanifest",
  },
  admin: {
    title: "Admin",
    description: "Server administration.",
    appTitle: "Admin",
    manifest: "/manifests/admin.webmanifest",
  },
};

function cacheBust(url: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${WORKSPACE_PWA_ICON_CACHE_VERSION}`;
}

function workspacePwaAppleTouchSrc(app: WorkspacePwaAppKey): string {
  return app === "home"
    ? cacheBust("/pwa-icons/home-180.png")
    : cacheBust(workspaceAppIconAppleTouchSrc(app));
}

function workspacePwaIconSvgSrc(app: WorkspacePwaAppKey): string {
  return app === "home"
    ? cacheBust("/app-icons/home-pwa.svg")
    : cacheBust(workspaceAppIconUiSrc(app));
}

export function createWorkspacePwaHead(
  app: WorkspacePwaAppKey,
  overrides?: Partial<Pick<WorkspacePwaMeta, "title" | "description">>,
) {
  const meta = WORKSPACE_PWA_META[app];

  return createPwaHead({
    title: overrides?.title ?? meta.title,
    description: overrides?.description ?? meta.description,
    appTitle: meta.appTitle,
    manifest: cacheBust(meta.manifest),
    appleTouchIcon: workspacePwaAppleTouchSrc(app),
    iconSvg: workspacePwaIconSvgSrc(app),
  });
}
