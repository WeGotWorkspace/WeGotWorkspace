import { useCallback, useMemo, useState } from "react";
import type { DriveFile, ViewKey } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import { apiPathFromUiPath } from "@/drive-core/src/drive-path-utils";
import {
  DOCS_DRIVE_UI_PERSONAL_PATH,
  resolveDocsHomeCreateDialogBrowsePath,
  resolveNewDocumentName,
} from "@/docs-core/src/docs-home-drives";
import { docsHomeCreateDocumentApiPath } from "@/docs-core/src/docs-home-workspace-model";
import { markdownNameFor } from "@/docs-core/src/docx-import/docx-file-name";

export type DocsHomeCreateDialogState = {
  createDialogOpen: boolean;
  createDialogDefaultName: string;
  createDialogBrowsePath: string;
  createDialogView: ViewKey;
  /** Set while the dialog names a Doc imported from this Word file (#1619). */
  createDialogImportSourceName: string | null;
  handleCreateDocument: () => void;
  handleImportWordFile: (file: File) => void;
  closeCreateDialog: () => void;
  confirmCreateDocument: (name: string, destinationPath: string) => void;
};

type UseDocsHomeCreateDialogArgs = {
  username: string;
  onCreateDocument?: (apiPath: string) => void;
  onImportWordFile?: (file: File, apiPath: string) => void;
  browsePathPrefix: string | undefined;
  listingOperations: Pick<DriveAPIOperations, "listDirectory"> | undefined;
  files: readonly DriveFile[];
  groupRootSlugs: readonly string[];
};

/** New-document dialog: freeze the sidebar drive, pick a free name, then confirm the API path. */
export function useDocsHomeCreateDialog({
  username,
  onCreateDocument,
  onImportWordFile,
  browsePathPrefix,
  listingOperations,
  files,
  groupRootSlugs,
}: UseDocsHomeCreateDialogArgs): DocsHomeCreateDialogState {
  const groupRootNames = useMemo(() => new Set(groupRootSlugs), [groupRootSlugs]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDialogDefaultName, setCreateDialogDefaultName] = useState("Untitled.md");
  const [createDialogBrowsePath, setCreateDialogBrowsePath] = useState(DOCS_DRIVE_UI_PERSONAL_PATH);
  const createDialogView = useMemo(
    () => ({ type: "folder" as const, path: createDialogBrowsePath }),
    [createDialogBrowsePath],
  );

  const [importFile, setImportFile] = useState<File | null>(null);

  const openDialog = useCallback(
    (file: File | null) => {
      // Freeze the sidebar drive at click time (path key stays "My Drive" / "Groups/…").
      const browsePath = resolveDocsHomeCreateDialogBrowsePath(browsePathPrefix ?? null);
      setCreateDialogBrowsePath(browsePath);
      setImportFile(file);
      const apiRoot = apiPathFromUiPath(browsePath, username, groupRootNames);
      const base = file ? markdownNameFor(file.name).replace(/\.md$/, "") : undefined;
      void (async () => {
        const name = await resolveNewDocumentName(listingOperations, apiRoot, files, base);
        setCreateDialogDefaultName(name);
        setCreateDialogOpen(true);
      })();
    },
    [browsePathPrefix, files, groupRootNames, listingOperations, username],
  );

  const handleCreateDocument = useCallback(() => {
    if (!username.trim() || !onCreateDocument) return;
    openDialog(null);
  }, [onCreateDocument, openDialog, username]);

  const handleImportWordFile = useCallback(
    (file: File) => {
      if (!username.trim() || !onImportWordFile) return;
      openDialog(file);
    },
    [onImportWordFile, openDialog, username],
  );

  const closeCreateDialog = useCallback(() => {
    setCreateDialogOpen(false);
    setImportFile(null);
  }, []);

  const confirmCreateDocument = useCallback(
    (name: string, destinationPath: string) => {
      const apiPath = docsHomeCreateDocumentApiPath(
        name,
        destinationPath,
        username,
        groupRootNames,
      );
      if (!apiPath) return;
      if (importFile) {
        if (!onImportWordFile) return;
        setCreateDialogOpen(false);
        setImportFile(null);
        onImportWordFile(importFile, apiPath);
        return;
      }
      if (!onCreateDocument) return;
      setCreateDialogOpen(false);
      onCreateDocument(apiPath);
    },
    [groupRootNames, importFile, onCreateDocument, onImportWordFile, username],
  );

  return {
    createDialogOpen,
    createDialogDefaultName,
    createDialogBrowsePath,
    createDialogView,
    createDialogImportSourceName: importFile?.name ?? null,
    handleCreateDocument,
    handleImportWordFile,
    closeCreateDialog,
    confirmCreateDocument,
  };
}
