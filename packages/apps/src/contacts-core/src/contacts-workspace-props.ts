import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";
import type { ContactsAPIOperations, ContactsUIData } from "@/contacts-core/src/contacts-types";

export type ContactsWorkspaceProps = {
  data: ContactsUIData;
  session: WorkspaceSession;
  labels?: Partial<ContactsUILabels>;
  /** Optional async backend operations for contacts mutations. */
  operations?: ContactsAPIOperations;
  /** Show list-column spinner while contacts bootstrap (shell + sidebar visible). */
  listLoading?: boolean;
  /** Manual refresh / reconnect in flight — button busy only; list stays visible. */
  listRefreshing?: boolean;
  /** Refetch address books and cards without reloading the whole app shell. */
  onRefreshList?: () => void;
  /** Invoked when the user chooses log out; navigation is owned by the app shell. */
  onLogout?: () => void;
  className?: string;
  /**
   * Initial view to restore from a deep-link URL (e.g. `"all"`, `"group:{id}"`).
   * Falls back to the address-book default when absent.
   */
  initialView?: string;
  /** Initial contact card `id` to open on load (e.g. from a deep-link URL). */
  initialContactId?: string;
  /** Called whenever the active view changes so the app layer can sync the URL. */
  onViewChange?: (view: string) => void;
  /** Called whenever the active contact changes so the app layer can sync the URL. */
  onContactChange?: (contactId: string) => void;
};
