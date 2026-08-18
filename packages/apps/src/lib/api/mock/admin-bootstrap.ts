import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { defaultMailDeliveryState } from "@/admin-core/src/admin-mail-delivery";
import type { AdminUIData, AdminUpdateCheck } from "@/admin-core/src/admin-types";

const DEFAULT_SERVER_CHECKS: AdminUpdateCheck[] = [
  { ok: true, label: "PHP runtime", detail: "Meets minimum version for this release." },
  { ok: true, label: "Database", detail: "Schema and migrations are consistent." },
  { ok: true, label: "Disk space", detail: "Enough free space for updates and backups." },
];

export type AdminAppBootstrap = {
  data: AdminUIData;
  session: WorkspaceSession;
};

const DEFAULT_DATA: AdminUIData = {
  users: [
    {
      id: "alice",
      username: "alice",
      email: "alice@example.test",
      displayName: "Alice Example",
      groups: ["principals/groups/administrators"],
      createdAt: "",
    },
  ],
  groups: [
    {
      id: "principals/groups/administrators",
      name: "administrators",
      displayName: "Administrators",
    },
  ],
  mail: {
    imapHost: "imap.example.test",
    imapPort: 993,
    imapSecurity: "ssl",
    smtpHost: "smtp.example.test",
    smtpPort: 465,
    smtpSecurity: "ssl",
  },
  mailDelivery: defaultMailDeliveryState({
    config: {
      from: "ops@example.test",
      transport: "auto",
      smtpHost: "smtp.example.test",
      smtpPort: 587,
      smtpSecurity: "starttls",
      smtpUsername: "relay",
      smtpPasswordSet: true,
    },
    capability: {
      canSubmit: true,
      selectedTransport: "smtp",
      probes: {
        fromConfigured: true,
        smtpEligible: true,
        smtpAuthRequired: true,
        phpMailAvailable: true,
        sendmailAvailable: false,
      },
    },
  }),
  rtc: {
    stunUrls: "",
    turnUrls: "",
    turnUsername: "",
    turnPassword: "",
  },
  apps: {
    calendars: true,
    contacts: true,
  },
  webdav: {
    sabreUi: true,
    timezone: "UTC",
    baseUri: "/",
    authRealm: "SabreDAV",
  },
  plugins: [],
  updates: {
    installChannel: null,
    installedVersion: "0.0.0",
    schemaVersion: 0,
    latest: null,
    updateAvailable: false,
    compatible: true,
    backups: [],
    checks: DEFAULT_SERVER_CHECKS,
    inProgress: false,
    phase: null,
    current: null,
    download: null,
    phaseProgress: null,
    cancelRequested: false,
    cancelAllowed: false,
    lastCheckedAt: null,
    lastCheckError: null,
    lastResult: null,
  },
  searchReindex: {
    inProgress: false,
    phase: null,
    phaseProgress: null,
    cancelRequested: false,
    lastResult: null,
    logLines: [],
  },
  currentUser: "",
  logoutUrl: "/logout",
  updateLogLines: [],
};

/** Aligns chrome session with admin directory data so sidebar footers match mock principals. */
function workspaceSessionForAdminData(data: AdminUIData): WorkspaceSession {
  const handle = data.currentUser?.trim();
  const match = handle ? data.users.find((u) => u.username === handle) : undefined;
  const row = match ?? data.users[0];
  if (row) {
    return {
      ...mockWorkspaceSession,
      user: {
        ...mockWorkspaceSession.user,
        displayName: row.displayName,
        username: row.username,
        email: row.email,
      },
    };
  }
  return {
    ...mockWorkspaceSession,
    user: {
      ...mockWorkspaceSession.user,
      displayName: "Administrator",
      username: "admin",
      email: "admin@example.test",
    },
  };
}

export function createAdminAppBootstrap(overrides?: {
  data?: AdminUIData;
  session?: WorkspaceSession;
}): AdminAppBootstrap {
  const data = overrides?.data ?? DEFAULT_DATA;
  return {
    data,
    session: overrides?.session ?? workspaceSessionForAdminData(data),
  };
}
