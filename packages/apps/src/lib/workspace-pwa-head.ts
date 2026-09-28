import { createPwaHead } from "@/lib/pwa-head";
import {
  workspaceAppIconAppleTouchSrc,
  workspaceAppIconUiSrc,
  type WorkspaceAppId,
} from "@/lib/workspace-app-icons";

/** Bump when launcher / apple-touch artwork changes to bust Safari icon cache. */
export const WORKSPACE_PWA_ICON_CACHE_VERSION = "19";

/**
 * Installed window chrome for every suite PWA (`theme_color`, `background_color`,
 * and the `theme-color` meta). Same hex as `--color-we-got-sand` / `--workspace-accent`.
 * Launcher tiles stay on `WORKSPACE_APP_ACCENT`.
 */
export const WORKSPACE_PWA_THEME_COLOR = "#ba9689";

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
  return app === "home" ? cacheBust("/app-icons/home.svg") : cacheBust(workspaceAppIconUiSrc(app));
}

export function createWorkspacePwaHead(
  app: WorkspacePwaAppKey,
  overrides?: Partial<Pick<WorkspacePwaMeta, "title" | "description">>,
) {
  const meta = WORKSPACE_PWA_META[app];

  return createPwaHead({
    title: overrides?.title ?? meta.title,
    description: overrides?.description ?? meta.description,
    themeColor: WORKSPACE_PWA_THEME_COLOR,
    appTitle: meta.appTitle,
    manifest: meta.manifest,
    appleTouchIcon: workspacePwaAppleTouchSrc(app),
    iconSvg: workspacePwaIconSvgSrc(app),
  });
}
