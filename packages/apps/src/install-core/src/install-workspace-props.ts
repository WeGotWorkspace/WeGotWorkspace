import type { InstallAPIOperations, InstallUIData } from "@/install-core/src/install-types";

export type InstallWorkspaceProps = {
  data: InstallUIData;
  /** When set (e.g. Storybook), installer actions use this instead of the live installer API. */
  operations?: InstallAPIOperations;
  className?: string;
};
