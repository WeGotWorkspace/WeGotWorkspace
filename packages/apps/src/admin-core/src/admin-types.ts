export type AdminSection =
  | "users"
  | "mail"
  | "email-delivery"
  | "collaboration"
  | "webdav"
  | "plugins"
  | "backups"
  | "updates"
  | "search";

export type AdminMailDeliveryTransport = "auto" | "smtp" | "php" | "sendmail";

export type AdminMailDeliverySelectedTransport = "smtp" | "php" | "sendmail" | null;

export type AdminMailDeliveryStatus =
  | "accepted_by_transport"
  | "unavailable"
  | "connect"
  | "auth"
  | "timeout"
  | "smtp_auth_required";

export type AdminMailDeliveryConfig = {
  from: string;
  transport: AdminMailDeliveryTransport;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: string;
  smtpUsername: string;
  smtpPasswordSet: boolean;
};

export type AdminMailDeliveryCapability = {
  canSubmit: boolean;
  selectedTransport: AdminMailDeliverySelectedTransport;
  probes: {
    fromConfigured: boolean;
    smtpEligible: boolean;
    smtpAuthRequired: boolean;
    phpMailAvailable: boolean;
    sendmailAvailable: boolean;
  };
};

export type AdminMailDeliveryLastTestSend = {
  accepted: boolean;
  status: AdminMailDeliveryStatus;
  transport: string;
  at: string;
  message: string | null;
};

export type AdminMailDeliveryState = {
  config: AdminMailDeliveryConfig;
  capability: AdminMailDeliveryCapability;
  lastTestSend: AdminMailDeliveryLastTestSend | null;
};

export type AdminUser = {
  id: string;
  username: string;
  email: string;
  displayName: string;
  groups: string[];
  createdAt: string;
};

export type AdminGroup = {
  id: string;
  name: string;
  displayName: string;
};

export type AdminMailSettings = {
  imapHost: string;
  imapPort: number;
  imapSecurity: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: string;
};

export type AdminRtcSettings = {
  stunUrls: string;
  turnUrls: string;
  turnUsername: string;
  turnPassword: string;
};

export type AdminAppsSettings = {
  calendars: boolean;
  contacts: boolean;
};

export type AdminWebdavSettings = {
  sabreUi: boolean;
  timezone: string;
  baseUri: string;
  authRealm: string;
};

export type AdminUpdateRelease = {
  version: string;
  package_url: string;
  checksum_sha256: string;
  checksum_signature: string;
};

export type AdminUpdateBackupItem = {
  name: string;
  sizeBytes: number;
  modifiedAt: string | null;
  fromVersion: string | null;
  toVersion: string | null;
  format: string;
  downloadable: boolean;
};

export type AdminUpdateCheck = {
  ok: boolean;
  label: string;
  detail: string;
  status?: string;
};

export type AdminUpdateCurrent = {
  from: string;
  to: string;
  at: string;
};

export type AdminUpdateDownload = {
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  updatedAt: string;
};

export type AdminUpdatePhaseProgress = {
  completed: number;
  total: number;
  percent: number;
  updatedAt: string;
};

export type AdminUpdateResult = {
  ok: boolean;
  version: string;
  message: string;
  finishedAt: string | null;
};

export type AdminUpdateState = {
  installChannel: string | null;
  installedVersion: string;
  imageTag?: string | null;
  schemaVersion: number;
  latest: AdminUpdateRelease | null;
  updateAvailable: boolean;
  compatible: boolean;
  backups: AdminUpdateBackupItem[];
  checks: AdminUpdateCheck[];
  inProgress: boolean;
  phase: string | null;
  current: AdminUpdateCurrent | null;
  download: AdminUpdateDownload | null;
  phaseProgress: AdminUpdatePhaseProgress | null;
  cancelRequested: boolean;
  cancelAllowed: boolean;
  lastCheckedAt: string | null;
  lastCheckError: string | null;
  lastResult: AdminUpdateResult | null;
};

export type AdminSearchReindexPhaseProgress = {
  completed: number;
  total: number;
  percent: number;
  updatedAt: string;
};

export type AdminSearchReindexResult = {
  ok: boolean;
  message: string;
  finishedAt: string | null;
};

export type AdminSearchReindexState = {
  inProgress: boolean;
  phase: string | null;
  phaseProgress: AdminSearchReindexPhaseProgress | null;
  cancelRequested: boolean;
  lastResult: AdminSearchReindexResult | null;
  logLines: string[];
};

export type AdminUIData = {
  users: AdminUser[];
  groups: AdminGroup[];
  mail: AdminMailSettings;
  mailDelivery: AdminMailDeliveryState;
  rtc: AdminRtcSettings;
  apps: AdminAppsSettings;
  webdav: AdminWebdavSettings;
  plugins: {
    id: string;
    name: string;
    active: boolean;
    source?: string;
  }[];
  updates: AdminUpdateState;
  searchReindex: AdminSearchReindexState;
  currentUser: string;
  logoutUrl: string;
  updateLogLines: string[];
};

export type AdminAPIOperations = {
  refreshState: (opts?: { signal?: AbortSignal }) => Promise<AdminUIData>;
  saveSettings: (
    values: Record<string, string | number | boolean | null>,
    opts?: { signal?: AbortSignal; clearSmtpPassword?: boolean },
  ) => Promise<AdminUIData>;
  sendMailDeliveryTest: (opts?: { signal?: AbortSignal; to?: string }) => Promise<AdminUIData>;
  checkUpdates: (opts?: { signal?: AbortSignal }) => Promise<AdminUIData>;
  refreshUpdateState: (opts?: { signal?: AbortSignal }) => Promise<AdminUpdateState>;
  applyUpdate: (version?: string, opts?: { signal?: AbortSignal }) => Promise<AdminUpdateState>;
  cancelUpdate: (opts?: { signal?: AbortSignal }) => Promise<AdminUpdateState>;
  startSearchReindex: (opts?: { signal?: AbortSignal }) => Promise<AdminSearchReindexState>;
  refreshSearchReindexState: (opts?: { signal?: AbortSignal }) => Promise<AdminSearchReindexState>;
  cancelSearchReindex: (opts?: { signal?: AbortSignal }) => Promise<AdminSearchReindexState>;
  refreshUpdateLog: (opts?: { signal?: AbortSignal }) => Promise<string[]>;
  clearUpdateLog: (opts?: { signal?: AbortSignal }) => Promise<string[]>;
  deleteBackup: (name: string, opts?: { signal?: AbortSignal }) => Promise<AdminUIData>;
  downloadBackup: (name: string, opts?: { signal?: AbortSignal }) => Promise<void>;
  createBackup: (opts?: { signal?: AbortSignal }) => Promise<AdminUIData>;
  createUser: (
    input: {
      username: string;
      password: string;
      displayName: string;
      email?: string;
      groups?: string[];
    },
    opts?: { signal?: AbortSignal },
  ) => Promise<AdminUIData>;
  updateUser: (
    username: string,
    input: { displayName?: string; email?: string; password?: string; groups?: string[] },
    opts?: { signal?: AbortSignal },
  ) => Promise<AdminUIData>;
  deleteUser: (username: string, opts?: { signal?: AbortSignal }) => Promise<AdminUIData>;
  createGroup: (
    input: { name: string; displayName?: string },
    opts?: { signal?: AbortSignal },
  ) => Promise<AdminUIData>;
  updateGroup: (
    groupSlug: string,
    input: { displayName?: string; members?: string[] },
    opts?: { signal?: AbortSignal },
  ) => Promise<AdminUIData>;
  deleteGroup: (groupSlug: string, opts?: { signal?: AbortSignal }) => Promise<AdminUIData>;
  activatePlugin: (pluginId: string, opts?: { signal?: AbortSignal }) => Promise<AdminUIData>;
  deactivatePlugin: (pluginId: string, opts?: { signal?: AbortSignal }) => Promise<AdminUIData>;
  installPluginZip: (file: File, opts?: { signal?: AbortSignal }) => Promise<AdminUIData>;
};
