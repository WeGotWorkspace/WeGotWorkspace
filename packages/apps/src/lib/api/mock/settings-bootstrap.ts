import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { SettingsUIData } from "@/settings-core/src/settings-types";

export type SettingsAppBootstrap = {
  data: SettingsUIData;
  session: WorkspaceSession;
};

const DEFAULT_DATA: SettingsUIData = {
  user: {
    username: "demo.user",
    displayName: "Demo User",
    email: "demo@example.test",
  },
  groups: [
    { id: "principals/groups/editorial", displayName: "Editorial Team" },
    { id: "principals/groups/studio", displayName: "Studio Crew" },
    { id: "principals/groups/northlight", displayName: "Northlight Project" },
    { id: "principals/groups/bindery", displayName: "Bindery Workshop" },
  ],
  mail: {
    imapUsername: "demo@example.test",
    imapHasPassword: true,
  },
  mailServer: {
    imapHost: "imap.northlight.studio",
    imapPort: 993,
    imapSecurity: "ssl",
    smtpHost: "smtp.northlight.studio",
    smtpPort: 465,
    smtpSecurity: "ssl",
  },
  logoutUrl: "/logout",
  mcpEnabled: true,
};

/** Aligns chrome session with settings `data.user` so sidebar footers (session-driven) match profile mocks. */
function workspaceSessionForSettingsData(data: SettingsUIData): WorkspaceSession {
  return {
    ...mockWorkspaceSession,
    user: {
      ...mockWorkspaceSession.user,
      displayName: data.user.displayName,
      username: data.user.username,
      email: data.user.email,
    },
  };
}

export function createSettingsAppBootstrap(overrides?: {
  data?: SettingsUIData;
  session?: WorkspaceSession;
}): SettingsAppBootstrap {
  const data = overrides?.data ?? DEFAULT_DATA;
  return {
    data,
    session: overrides?.session ?? workspaceSessionForSettingsData(data),
  };
}
