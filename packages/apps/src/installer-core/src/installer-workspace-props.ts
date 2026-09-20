import type { InstallerAPIOperations, InstallerUIData } from "@/installer-core/src/installer-types";

export type InstallerWorkspaceProps = {
  data: InstallerUIData;
  /** When set (e.g. Storybook), installer actions use this instead of the live installer API. */
  operations?: InstallerAPIOperations;
  className?: string;
};
