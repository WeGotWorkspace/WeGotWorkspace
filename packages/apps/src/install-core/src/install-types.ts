export type {
  InstallerDatabasePayload,
  InstallerInstallPayload,
  InstallerRequirementsPayload,
  InstallerSitePayload,
} from "@/lib/api/wgw/installer";
export type { WgwInstallerActionResponse, WgwInstallerRuntimeState } from "@/lib/api/wgw";

import type {
  InstallerDatabasePayload,
  InstallerInstallPayload,
  InstallerRequirementsPayload,
  InstallerSitePayload,
} from "@/lib/api/wgw/installer";
import type { WgwInstallerActionResponse, WgwInstallerRuntimeState } from "@/lib/api/wgw";

export type InstallStepId =
  | "welcome"
  | "server"
  | "database"
  | "dav"
  | "mail"
  | "meet"
  | "admin"
  | "done";

export type InstallerBackendStep =
  | "welcome"
  | "requirements"
  | "database"
  | "site"
  | "account"
  | "done"
  | "installed";

export type InstallCheckStatus = "ok" | "warn" | "error" | "pending";

export type InstallServerCheck = {
  id: string;
  label: string;
  status: InstallCheckStatus;
  detail: string;
};

export type InstallUIData = {
  state: WgwInstallerRuntimeState | null;
};

export type InstallAPIOperations = {
  welcomeNext: () => Promise<WgwInstallerActionResponse>;
  requirementsCheck: (payload: InstallerRequirementsPayload) => Promise<WgwInstallerActionResponse>;
  requirementsNext: (payload: InstallerRequirementsPayload) => Promise<WgwInstallerActionResponse>;
  databaseTest: (payload: InstallerDatabasePayload) => Promise<WgwInstallerActionResponse>;
  databaseNext: (payload: InstallerDatabasePayload) => Promise<WgwInstallerActionResponse>;
  siteNext: (payload: InstallerSitePayload) => Promise<WgwInstallerActionResponse>;
  install: (payload: InstallerInstallPayload) => Promise<WgwInstallerActionResponse>;
};

export type InstallDbType = "sqlite" | "mysql";

export type InstallMysqlForm = {
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
};

export type InstallDavForm = {
  files: boolean;
  contacts: boolean;
  calendars: boolean;
};

export type InstallMailForm = {
  enabled: boolean;
  imapHost: string;
  imapPort: string;
  imapSec: string;
  imapUsername: string;
  imapPassword: string;
  smtpHost: string;
  smtpPort: string;
  smtpSec: string;
  smtpUsername: string;
  smtpPassword: string;
};

export type InstallMeetForm = {
  enabled: boolean;
  stun: string;
  turn: string;
  turnUser: string;
  turnPwd: string;
};

export type InstallAdminForm = {
  username: string;
  displayName: string;
  email: string;
  password: string;
  password2: string;
};

export type InstallMysqlTestState = {
  state: "idle" | "testing" | "ok" | "error";
  message?: string;
};
