import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type { DriveShareOperations } from "@/drive-core/src/drive-types";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import type { NotesAPIOperations, NotesUIData } from "@/notes-core/src/notes-types";

export type NotesWorkspaceProps = {
  data: NotesUIData;
  session: WorkspaceSession;
  labels?: Partial<NotesUILabels>;
  /** Optional async backend operations for notes mutations. */
  operations?: NotesAPIOperations;
  /** Optional Drive path-share ops (ShareDialog on notes / notebooks). */
  shareOperations?: DriveShareOperations;
  /** Show list-column spinner while notes bootstrap (shell + sidebar visible). */
  listLoading?: boolean;
  /** Manual refresh in flight — button busy only; list stays visible. */
  listRefreshing?: boolean;
  /** Bumps when bootstrap is patched after reconnect or conflict resolution. */
  bootstrapRevision?: number;
  /** Refresh cached bootstrap after reconnect or conflict resolution. */
  onRefreshList?: () => void;
  /** Invoked when the user chooses log out; navigation is owned by the app shell. */
  onLogout?: () => void;
  className?: string;
  /**
   * Initial view to restore from a deep-link URL (e.g. `"all"`, `"nb:Drafts"`, `"tag:focus"`).
   * Falls back to `"all"` when absent.
   */
  initialView?: string;
  /** Initial note `id` to open on load (e.g. from a deep-link URL). */
  initialNoteId?: string;
  /** Called whenever the active view changes so the app layer can sync the URL. */
  onViewChange?: (view: string) => void;
  /** Called whenever the active note changes so the app layer can sync the URL. */
  onNoteChange?: (noteId: string) => void;
};
