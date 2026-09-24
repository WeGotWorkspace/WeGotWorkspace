import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type { AdminAPIOperations, AdminSection, AdminUIData } from "@/admin-core/src/admin-types";

export type AdminWorkspaceProps = {
  data: AdminUIData;
  session: WorkspaceSession;
  operations?: AdminAPIOperations;
  listLoading?: boolean;
  /** Route-owned section (`/admin` or `/admin/:section`). Uncontrolled when omitted. */
  section?: AdminSection;
  /** Deep-link / story initial section when `section` is uncontrolled. */
  initialSection?: AdminSection;
  /** Invoked when the user chooses a sidebar section; navigation is owned by the app shell. */
  onSectionChange?: (section: AdminSection) => void;
  /** Invoked when the user chooses log out; navigation is owned by the app shell. */
  onLogout?: () => void;
  className?: string;
};
