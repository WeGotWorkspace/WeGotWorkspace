/**
 * One app's configuration of the Drive workspace on the local file tree
 * (#2063 C4). Drive lists every entry; Docs home is the same workspace with an
 * entry filter, its own views, labels, create actions and open-file rule. Both
 * read their rows through `useFileTreeView` and write through Drive's hybrid
 * operations; nothing in a config fetches.
 */
import type { DriveFile } from "@/lib/files/drive-models";
import type { FileTreeEntryFilter, FileTreeView } from "@/lib/files/tree-view/tree-view-predicates";

/** What opening a row does: open it, or tell the person why not. */
export type FileWorkspaceOpenAction = { kind: "open" } | { kind: "notice"; message: string };

export type FileWorkspaceConfig<TView> = {
  /** What the app lists of every view. Drive passes none. */
  entryFilter?: FileTreeEntryFilter;
  /** The tree view behind one sidebar view. */
  treeView: (view: TView) => FileTreeView;
  /** Header title of a view. */
  title: (view: TView) => string;
  /** Empty-state copy of a view that is known empty. */
  emptyMessage: (view: TView) => string;
  /** Where "New" first goes from this view, so the new file lands in sight; null stays. */
  createJumpsTo: (view: TView) => TView | null;
  /** What opening `file` does. */
  openFile: (file: DriveFile) => FileWorkspaceOpenAction;
};
