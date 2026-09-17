import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type {
  SettingsAPIOperations,
  SettingsSection,
  SettingsUIData,
} from "@/settings-core/src/settings-types";

export type SettingsWorkspaceProps = {
  data: SettingsUIData;
  session: WorkspaceSession;
  operations?: SettingsAPIOperations;
  listLoading?: boolean;
  /** Route-owned section (`/settings` or `/settings/:section`). Uncontrolled when omitted. */
  section?: SettingsSection;
  /** Deep-link / story initial section when `section` is uncontrolled. */
  initialSection?: SettingsSection;
  /** Invoked when the user chooses a sidebar section; navigation is owned by the app shell. */
  onSectionChange?: (section: SettingsSection) => void;
  /** Invoked when the user chooses log out; navigation is owned by the app shell. */
  onLogout?: () => void;
  className?: string;
};
