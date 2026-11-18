import type { SettingsProfileRequest } from "@wgw/openapi-types/settings-types";

export const BUILTIN_PANEL_IDS = [
  "profile",
  "memberships",
  "offline",
  "assistants",
  "incoming-email",
  "calendar",
  "tasks",
  "contacts",
  "notes",
  "docs",
  "meet",
  "diagnostics",
  "about",
] as const;

/** Handwritten / JIT ids for `openPanel`. `"calender"` is a type error. */
export type BuiltinPanelId = (typeof BUILTIN_PANEL_IDS)[number];

/** Registry and URL segment id. Do not write `BuiltinPanelId | string`. */
export type SettingsPanelId = string;

/** Route-owned Settings section; same as {@link SettingsPanelId}. */
export type SettingsSection = SettingsPanelId;

/**
 * Sidebar sections: who you are, what you connected (a mailbox, assistants), this
 * device (stored in this browser), the apps, and about the product.
 */
export type SettingsPanelGroup = "account" | "connections" | "device" | "apps" | "about";

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
  /** Members of the Team, the user included. */
  memberCount: number;
};

export type SettingsMcpShareCall = {
  tool: string;
  outcome: string;
  createdAt: string;
  target: string | null;
};

export type SettingsMcpGrant = {
  clientId: string;
  clientName: string;
  clientOrigin: string;
  /** `cimd`: name and origin from the vendor's HTTPS metadata. `dcr`: name chosen by the client itself. */
  clientRegistration: "cimd" | "dcr";
  /** Approval time, else the first token for this client. */
  connectedAt: string;
  /** When the user approved on the consent page. Null for grants approved before this was recorded. */
  approvedAt: string | null;
  /** User agent of the browser the user approved in. Null when unknown. */
  approvedUserAgent: string | null;
  scopes: string[];
  lastUsedAt: string | null;
  /** Last share-tool MCP calls for this assistant. Required by the OpenAPI grant schema. */
  shareCalls: SettingsMcpShareCall[];
};

export type SettingsUIData = {
  user: SettingsUser;
  groups: SettingsGroup[];
  logoutUrl: string;
  /** Admin MCP kill-switch. Settings hides AI assistants when false. */
  mcpEnabled: boolean;
};

export type SettingsAPIOperations = {
  saveProfile: (
    input: SettingsProfileRequest,
    opts?: { signal?: AbortSignal },
  ) => Promise<SettingsUIData>;
  listMcpGrants?: (opts?: { signal?: AbortSignal }) => Promise<SettingsMcpGrant[]>;
  revokeMcpGrant?: (clientId: string, opts?: { signal?: AbortSignal }) => Promise<void>;
};
