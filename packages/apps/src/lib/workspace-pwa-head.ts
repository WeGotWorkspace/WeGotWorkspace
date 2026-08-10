import { createPwaHead } from "@/lib/pwa-head";
import {
  WORKSPACE_APP_ACCENT,
  WORKSPACE_HOME_ACCENT,
  workspaceAppIconAppleTouchSrc,
  workspaceAppIconUiSrc,
  type WorkspaceAppId,
} from "@/lib/workspace-app-icons";

/** Bump when launcher / apple-touch artwork changes to bust Safari icon cache. */
export const WORKSPACE_PWA_ICON_CACHE_VERSION = "7";

export type WorkspacePwaAppKey = WorkspaceAppId | "home";

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
  mail: {
    title: "Mail",
    description: "A calm inbox for focused correspondence.",
    appTitle: "Mail",
    manifest: "/manifests/mail.webmanifest",
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

function workspacePwaThemeColor(app: WorkspacePwaAppKey): string {
  return app === "home" ? WORKSPACE_HOME_ACCENT : WORKSPACE_APP_ACCENT[app];
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
    themeColor: workspacePwaThemeColor(app),
    appTitle: meta.appTitle,
    manifest: meta.manifest,
    appleTouchIcon: workspacePwaAppleTouchSrc(app),
    iconSvg: workspacePwaIconSvgSrc(app),
  });
}
