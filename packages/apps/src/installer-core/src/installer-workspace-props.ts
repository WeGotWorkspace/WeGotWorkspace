import type { InstallerAPIOperations, InstallerUIData } from "@/installer-core/src/installer-types";

export type InstallerWorkspaceProps = {
  data: InstallerUIData;
  /** When set (e.g. Storybook), installer actions use this instead of the live installer API. */
  operations?: InstallerAPIOperations;
  className?: string;
  /** Ready screen, when this tab did not create the admin: the app sends the user to sign in. */
  onOpenWorkspace?: () => void;
  /** Ready screen, after the new admin was signed in here: the app opens the workspace. */
  onAdminSignedIn?: () => void;
  /** Whether the page is https or localhost; defaults to the browser's answer. Stories and tests set it. */
  secureContext?: boolean;
};
