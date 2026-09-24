import type {
  InstallerDatabasePayload,
  InstallerInstallPayload,
  InstallerRequirementsPayload,
  InstallerSitePayload,
  InstallerAPIOperations,
  InstallerBackendStep,
  WgwInstallerActionResponse,
  WgwInstallerRuntimeState,
} from "@/installer-core/src/installer-types";

function cloneState(state: WgwInstallerRuntimeState): WgwInstallerRuntimeState {
  return structuredClone(state);
}

/** Client-side installer actions for Storybook and offline demos. */
export function createMockInstallerOperations(
  seed: WgwInstallerRuntimeState,
): InstallerAPIOperations {
  let state = cloneState(seed);

  const respond = (
    patch: Partial<WgwInstallerRuntimeState> | InstallerBackendStep,
  ): WgwInstallerActionResponse => {
    if (typeof patch === "string") {
      state = { ...state, step: patch };
    } else {
      state = { ...state, ...patch };
    }
    return { ok: true, state: cloneState(state) };
  };

  return {
    welcomeNext: async () => respond("requirements"),
    requirementsCheck: async (payload: InstallerRequirementsPayload) =>
      respond({ db_driver: payload.db_driver }),
    requirementsNext: async (payload: InstallerRequirementsPayload) =>
      respond({ step: "database", db_driver: payload.db_driver }),
    databaseTest: async () => respond(state),
    databaseNext: async (payload: InstallerDatabasePayload) =>
      respond({
        step: "site",
        db_driver: payload.db_driver,
        db: {
          sqlite_path: payload.sqlite_path,
          mysql_host: payload.mysql_host,
          mysql_port: payload.mysql_port,
          mysql_db: payload.mysql_db,
          mysql_user: payload.mysql_user,
        },
      }),
    siteNext: async (payload: InstallerSitePayload) =>
      respond({
        step: "site",
        timezone: payload.timezone,
        enable_files: payload.enable_files,
        enable_calendars: payload.enable_calendars,
        enable_contacts: payload.enable_contacts,
        show_browser_ui: payload.show_browser_ui,
      }),
    install: async (_payload: InstallerInstallPayload) =>
      respond({ step: "done", already_installed: true }),
  };
}
