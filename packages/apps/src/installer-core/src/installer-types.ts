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

export type InstallerBackendStep =
  | "welcome"
  | "requirements"
  | "database"
  | "site"
  | "account"
  | "done"
  | "installed";

export type InstallerCheckStatus = "ok" | "warn" | "error" | "pending";

export type InstallerServerCheck = {
  id: string;
  label: string;
  status: InstallerCheckStatus;
  detail: string;
};

export type InstallerUIData = {
  state: WgwInstallerRuntimeState | null;
};

export type InstallerAPIOperations = {
  welcomeNext: () => Promise<WgwInstallerActionResponse>;
  requirementsCheck: (payload: InstallerRequirementsPayload) => Promise<WgwInstallerActionResponse>;
  requirementsNext: (payload: InstallerRequirementsPayload) => Promise<WgwInstallerActionResponse>;
  databaseTest: (payload: InstallerDatabasePayload) => Promise<WgwInstallerActionResponse>;
  databaseNext: (payload: InstallerDatabasePayload) => Promise<WgwInstallerActionResponse>;
  siteNext: (payload: InstallerSitePayload) => Promise<WgwInstallerActionResponse>;
  install: (payload: InstallerInstallPayload) => Promise<WgwInstallerActionResponse>;
};
