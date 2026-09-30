import type {
  SettingsMailRequest,
  SettingsProfileRequest,
} from "@wgw/openapi-types/settings-types";

export const BUILTIN_PANEL_IDS = [
  "profile",
  "memberships",
  "offline",
  "assistants",
  "mail",
  "calendar",
  "tasks",
  "contacts",
  "notes",
] as const;

/** Handwritten / JIT ids for `openPanel`. `"mial"` is a type error. */
export type BuiltinPanelId = (typeof BUILTIN_PANEL_IDS)[number];

/** Registry and URL segment id. Do not write `BuiltinPanelId | string`. */
export type SettingsPanelId = string;

/** Route-owned Settings section; same as {@link SettingsPanelId}. */
export type SettingsSection = SettingsPanelId;

export type SettingsPanelGroup = "account" | "apps";

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
