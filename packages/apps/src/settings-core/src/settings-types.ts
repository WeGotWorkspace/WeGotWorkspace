import type {
  SettingsMailRequest,
  SettingsProfileRequest,
} from "@wgw-api-generated/settings-types";

export type SettingsSection = "profile" | "memberships" | "mail" | "offline" | "assistants";

export type SettingsSectionDescriptor = {
  id: SettingsSection;
  label: string;
  description: string;
};

export type SettingsUser = {
  username: string;
  displayName: string;
  email: string;
};

export type SettingsGroup = {
  id: string;
  displayName: string;
};

export type SettingsMailCredentials = {
  imapUsername: string;
  imapHasPassword: boolean;
};

export type SettingsMailServer = {
  imapHost: string;
  imapPort: number;
  imapSecurity: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: string;
};

export type SettingsMcpGrant = {
  clientId: string;
  clientName: string;
  clientOrigin: string;
  connectedAt: string;
  scopes: string[];
  lastUsedAt: string | null;
};

export type SettingsUIData = {
  user: SettingsUser;
  groups: SettingsGroup[];
  mail: SettingsMailCredentials;
  mailServer: SettingsMailServer;
  logoutUrl: string;
  /** Admin MCP kill-switch. Settings hides Connected assistants when false. */
  mcpEnabled: boolean;
};

export type SettingsAPIOperations = {
  saveProfile: (
    input: SettingsProfileRequest,
    opts?: { signal?: AbortSignal },
  ) => Promise<SettingsUIData>;
  saveMail: (
    input: SettingsMailRequest,
    opts?: { signal?: AbortSignal },
  ) => Promise<SettingsUIData>;
  listMcpGrants?: (opts?: { signal?: AbortSignal }) => Promise<SettingsMcpGrant[]>;
  revokeMcpGrant?: (clientId: string, opts?: { signal?: AbortSignal }) => Promise<void>;
};
