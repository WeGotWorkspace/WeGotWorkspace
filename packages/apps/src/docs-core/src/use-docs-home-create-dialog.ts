import { useCallback, useMemo, useRef, useState } from "react";
import type { DriveFile, ViewKey } from "@/lib/files/drive-models";
import type { DriveAPIOperations } from "@/lib/files/drive-types";
import { apiPathFromUiPath } from "@/lib/files/drive-path-utils";
import {
  DOCS_DRIVE_UI_PERSONAL_PATH,
  resolveDocsHomeCreateDialogBrowsePath,
  resolveImportDocumentNames,
  resolveNewDocumentName,
} from "@/docs-core/src/docs-home-drives";
import { docsHomeCreateDocumentApiPath } from "@/docs-core/src/docs-home-workspace-model";
import { markdownNameFor } from "@/docs-core/src/docx-import/docx-file-name";
import type { DocxImportEntry } from "@/docs-core/src/docx-import/docx-import-entry";

export type DocsHomeCreateDialogState = {
  createDialogOpen: boolean;
  createDialogDefaultName: string;
  createDialogBrowsePath: string;
  createDialogView: ViewKey;
  /** Set while the dialog names a Doc imported from this Word file (#1619). */
  createDialogImportSourceName: string | null;
  /** Word files picked for import; with more than one the dialog asks only for the folder. */
  createDialogImportCount: number;
  handleCreateDocument: () => void;
  handleImportWordFiles: (files: File[]) => void;
  closeCreateDialog: () => void;
  confirmCreateDocument: (name: string, destinationPath: string) => void;
};

type UseDocsHomeCreateDialogArgs = {
  username: string;
  onCreateDocument?: (apiPath: string) => void;
  onImportWordFiles?: (entries: DocxImportEntry[]) => void;
  browsePathPrefix: string | undefined;
  listingOperations: Pick<DriveAPIOperations, "listDirectory"> | undefined;
  files: readonly DriveFile[];
  groupRootSlugs: readonly string[];
};

const markdownBaseFor = (file: File) => markdownNameFor(file.name).replace(/\.md$/, "");

/** New-document dialog: freeze the sidebar drive, pick a free name, then confirm the API path. */
export function useDocsHomeCreateDialog({
  username,
  onCreateDocument,
  onImportWordFiles,
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

  const [importFiles, setImportFiles] = useState<File[]>([]);
  // Latest open request; a name lookup that finishes for an older one is ignored.
  const openRequestRef = useRef(0);

  const openDialog = useCallback(
    (picked: File[]) => {
      // Freeze the sidebar drive at click time (path key stays "My Drive" / "Groups/…").
      const browsePath = resolveDocsHomeCreateDialogBrowsePath(browsePathPrefix ?? null);
      setCreateDialogBrowsePath(browsePath);
      setImportFiles(picked);
      const apiRoot = apiPathFromUiPath(browsePath, username, groupRootNames);
      const only = picked.length === 1 ? picked[0] : undefined;
      const base = only ? markdownBaseFor(only) : undefined;
      const request = ++openRequestRef.current;
      void (async () => {
        const name = await resolveNewDocumentName(listingOperations, apiRoot, files, base);
        if (request !== openRequestRef.current) return;
        setCreateDialogDefaultName(name);
        setCreateDialogOpen(true);
      })();
    },
    [browsePathPrefix, files, groupRootNames, listingOperations, username],
  );

  const handleCreateDocument = useCallback(() => {
    if (!username.trim() || !onCreateDocument) return;
    openDialog([]);
  }, [onCreateDocument, openDialog, username]);

  const handleImportWordFiles = useCallback(
    (files: File[]) => {
      if (!username.trim() || !onImportWordFiles || files.length === 0) return;
      openDialog(files);
    },
    [onImportWordFiles, openDialog, username],
  );

  const closeCreateDialog = useCallback(() => {
    openRequestRef.current += 1;
    setCreateDialogOpen(false);
    setImportFiles([]);
  }, []);

  const confirmCreateDocument = useCallback(
    (name: string, destinationPath: string) => {
      const apiPath = docsHomeCreateDocumentApiPath(
        name,
        destinationPath,
        username,
        groupRootNames,
      );
      if (importFiles.length > 1) {
        if (!onImportWordFiles) return;
        const picked = importFiles;
        setCreateDialogOpen(false);
        setImportFiles([]);
        const apiRoot = apiPathFromUiPath(destinationPath, username, groupRootNames);
        void resolveImportDocumentNames(
          listingOperations,
          apiRoot,
          files,
          picked.map(markdownBaseFor),
        ).then((names) =>
          onImportWordFiles(
            picked.map((file, index) => ({
              file,
              apiPath: docsHomeCreateDocumentApiPath(
                names[index]!,
                destinationPath,
                username,
                groupRootNames,
              )!,
            })),
          ),
        );
        return;
      }
      if (!apiPath) return;
      if (importFiles.length === 1) {
        if (!onImportWordFiles) return;
        setCreateDialogOpen(false);
        setImportFiles([]);
        onImportWordFiles([{ file: importFiles[0]!, apiPath }]);
        return;
      }
      if (!onCreateDocument) return;
      setCreateDialogOpen(false);
      onCreateDocument(apiPath);
    },
    [
      files,
      groupRootNames,
      importFiles,
      listingOperations,
      onCreateDocument,
      onImportWordFiles,
      username,
    ],
  );

  return {
    createDialogOpen,
    createDialogDefaultName,
    createDialogBrowsePath,
    createDialogView,
    createDialogImportSourceName: importFiles.length === 1 ? importFiles[0]!.name : null,
    createDialogImportCount: importFiles.length,
    handleCreateDocument,
    handleImportWordFiles,
    closeCreateDialog,
    confirmCreateDocument,
  };
}
