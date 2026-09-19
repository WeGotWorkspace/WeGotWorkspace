import {
  installerDatabaseNext,
  installerDatabaseTest,
  installerInstall,
  installerRequirementsCheck,
  installerRequirementsNext,
  installerSiteNext,
  installerWelcomeNext,
} from "@/lib/api/wgw/installer";
import type { InstallerAPIOperations } from "@/installer-core/src/installer-types";

export const wgwInstallerOperations: InstallerAPIOperations = {
  welcomeNext: () => installerWelcomeNext(),
  requirementsCheck: (payload) => installerRequirementsCheck(payload),
  requirementsNext: (payload) => installerRequirementsNext(payload),
  databaseTest: (payload) => installerDatabaseTest(payload),
  databaseNext: (payload) => installerDatabaseNext(payload),
  siteNext: (payload) => installerSiteNext(payload),
  install: (payload) => installerInstall(payload),
};
