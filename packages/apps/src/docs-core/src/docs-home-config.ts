/**
 * Docs home as a configuration of the Drive workspace (#2063 C4): the entry
 * filter, the views, labels, create actions and open-file rule. Its rows are
 * Drive's file tree narrowed by {@link DOCS_HOME_ENTRY_FILTER}; nothing here
 * fetches.
 */
import type { FileWorkspaceConfig } from "@/drive-core/src/file-workspace-config";
import { DOCS_HOME_LIST_EXTENSIONS } from "@/lib/files/docs-home-listing";
import type { FileTreeEntryFilter, FileTreeView } from "@/lib/files/tree-view/tree-view-predicates";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import { docsPersonalDrivePathPrefix } from "@/docs-core/src/docs-home-drives";
import { docsHomeCreateJumpsToPersonal, type DocsHomeView } from "@/docs-core/src/docs-home-shared";
import {
  docsHomeEmptyMessage,
  docsHomeHeaderTitle,
} from "@/docs-core/src/docs-home-workspace-model";
import {
  isSaveAsMarkdownOnlyFile,
  saveAsMarkdownSourceKindFromName,
} from "@/docs-core/src/docx-import/save-as-markdown-source";
import { docxImportLabels } from "@/docs-core/src/docx-import/docx-import-labels";

/**
 * What Docs home lists of every view: files Docs opens (Markdown, plain text)
 * plus Word files and Google links for Save as Markdown (#1983). No folders.
 */
export const DOCS_HOME_ENTRY_FILTER: FileTreeEntryFilter = {
  extensions: DOCS_HOME_LIST_EXTENSIONS,
  filesOnly: true,
};

/**
 * The tree view of a Docs home view. All Docs is every file of the tree,
 * shared ones included (it used to merge Shared with me in); a drive is
 * every file under its root.
 */
export function docsHomeTreeView(view: DocsHomeView): FileTreeView {
  switch (view.type) {
    case "all":
      return { kind: "prefix", path: "" };
    case "recent":
      return { kind: "recent" };
    case "starred":
      return { kind: "starred" };
    case "shared":
      return { kind: "shared" };
    case "trash":
      return { kind: "trash" };
    case "tag":
      return { kind: "tag", tag: view.tag };
    case "drive":
      return { kind: "prefix", path: view.pathPrefix };
  }
}

export type DocsHomeConfigInput = {
  labels: DocsUILabels;
  username: string;
  /** The sidebar's drives, for the title of a drive view. */
  drives: readonly { pathPrefix: string; label: string }[];
};

/** Docs home's configuration of the Drive workspace. */
export function docsHomeWorkspaceConfig({
  labels,
  username,
  drives,
}: DocsHomeConfigInput): FileWorkspaceConfig<DocsHomeView> {
  return {
    entryFilter: DOCS_HOME_ENTRY_FILTER,
    treeView: docsHomeTreeView,
    title: (view) => docsHomeHeaderTitle(view, labels, drives),
    emptyMessage: (view) => docsHomeEmptyMessage(view, labels),
    createJumpsTo: (view) => {
      const personal = docsPersonalDrivePathPrefix(username);
      return personal && docsHomeCreateJumpsToPersonal(view)
        ? { type: "drive", pathPrefix: personal }
        : null;
    },
    openFile: (file) => {
      // Word files and Google links are listed for Save as Markdown, not opened (#1983).
      if (!isSaveAsMarkdownOnlyFile(file)) return { kind: "open" };
      return {
        kind: "notice",
        message:
          saveAsMarkdownSourceKindFromName(file.title) === "gdoc"
            ? docxImportLabels.googleLinkDescription(file.title)
            : docxImportLabels.openDocxInDocs,
      };
    },
  };
}
