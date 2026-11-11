import type { ReactNode } from "react";
import type { DriveFileMenuAction } from "@/drive-core/src/drive-file-actions";
import type { DriveFile, ViewKey } from "@/lib/files/drive-models";
import type {
  DriveAPIOperations,
  DriveShareOperations,
  DriveUIData,
} from "@/lib/files/drive-types";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";

/** Row actions another app adds to Drive files, with the dialogs they open. */
export type DriveFileActionSource = {
  actionsFor: (file: DriveFile) => DriveFileMenuAction[];
  dialogs: ReactNode;
};

export type DriveWorkspaceProps = {
  data: DriveUIData;
  session: WorkspaceSession;
  operations?: DriveAPIOperations;
  shareOperations?: DriveShareOperations;
  listLoading?: boolean;
  /** Enables Dexie offline layer (live app only). */
  offlineUsername?: string | null;
  /** When set with {@link onViewChange}, view is controlled by the host (e.g. URL). */
  view?: ViewKey;
  /** Emitted when the user navigates; host should update routing. */
  onViewChange?: (view: ViewKey) => void;
  /** Opens a Markdown file in the Docs app (host implements routing). */
  onOpenDocsFile?: (apiPath: string) => void;
  /**
   * Save as Markdown for Word files, from Docs (#1983). The host passes it in,
   * so Drive does not import Docs. Offered only where the person can create
   * files, because the new `.md` lands next to the Word file.
   */
  saveAsMarkdown?: DriveFileActionSource;
  /** Opens ShareDialog for a virtual API path (Phase 3 wiring). */
  onOpenShare?: (apiPath: string) => void;
  onLogout?: () => void;
  className?: string;
};
