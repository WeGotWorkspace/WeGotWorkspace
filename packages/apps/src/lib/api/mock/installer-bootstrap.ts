import type { InstallerWorkspaceProps } from "@/installer-core/src/installer-workspace-props";
import type { InstallerAPIOperations, InstallerUIData } from "@/installer-core/src/installer-types";
import { createMockInstallerOperations } from "@/lib/api/mock/installer-mock-operations";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { WgwInstallerRuntimeState } from "@/lib/api/wgw";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";

export type InstallerWorkspaceBootstrap = Pick<InstallerWorkspaceProps, "data" | "operations">;

/** API bootstrap shape: workspace props plus session for `useWorkspaceApi` chrome parity. */
export type InstallerAppBootstrap = InstallerWorkspaceBootstrap & {
  session: WorkspaceSession;
};

const DEFAULT_INSTALLER_STATE: WgwInstallerRuntimeState = {
  step: "welcome",
  flash: null,
  already_installed: false,
  db_driver: "sqlite",
  db: {
    sqlite_path: "wgw-content/db.sqlite",
  },
  enable_files: true,
  enable_contacts: true,
  enable_calendars: true,
  timezone: "UTC",
  base_uri: "/",
  show_browser_ui: true,
  checks: [
    { label: "PHP version", ok: true, detail: "8.3" },
    { label: "Writable data directory", ok: true, detail: "wgw-content is writable" },
    { label: "cURL extension", ok: true, detail: "Available" },
    { label: "PDO SQLite", ok: true, detail: "Available" },
  ],
};

const DEFAULT_DATA: InstallerUIData = {
  state: DEFAULT_INSTALLER_STATE,
};

export function createInstallerAppBootstrap(overrides?: {
  data?: InstallerUIData;
  operations?: InstallerAPIOperations;
}): InstallerAppBootstrap {
  const data = overrides?.data ?? DEFAULT_DATA;
  const seedState = data.state ?? DEFAULT_INSTALLER_STATE;
  return {
    data,
    session: mockWorkspaceSession,
    operations: overrides?.operations ?? createMockInstallerOperations(seedState),
  };
}

/** Story/workspace args without session — installer chrome does not use a user footer. */
export function createInstallerWorkspaceStoryArgs(
  overrides?: Parameters<typeof createInstallerAppBootstrap>[0],
): InstallerWorkspaceBootstrap {
  const { session: _session, ...workspaceArgs } = createInstallerAppBootstrap(overrides);
  return workspaceArgs;
}
