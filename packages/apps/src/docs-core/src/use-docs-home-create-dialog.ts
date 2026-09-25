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

export type DocsHomeCreateDialogState = {
  createDialogOpen: boolean;
  createDialogDefaultName: string;
  createDialogBrowsePath: string;
  createDialogView: ViewKey;
  handleCreateDocument: () => void;
  closeCreateDialog: () => void;
  confirmCreateDocument: (name: string, destinationPath: string) => void;
};

type UseDocsHomeCreateDialogArgs = {
  username: string;
  onCreateDocument?: (apiPath: string) => void;
  browsePathPrefix: string | undefined;
  listingOperations: Pick<DriveAPIOperations, "listDirectory"> | undefined;
  files: readonly DriveFile[];
  groupRootNames: Set<string>;
};

/** New-document dialog: freeze the sidebar drive, pick a free name, then confirm the API path. */
export function useDocsHomeCreateDialog({
  username,
  onCreateDocument,
  browsePathPrefix,
  listingOperations,
  files,
  groupRootNames,
}: UseDocsHomeCreateDialogArgs): DocsHomeCreateDialogState {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDialogDefaultName, setCreateDialogDefaultName] = useState("Untitled.md");
  const [createDialogBrowsePath, setCreateDialogBrowsePath] = useState(DOCS_DRIVE_UI_PERSONAL_PATH);
  const createDialogView = useMemo(
    () => ({ type: "folder" as const, path: createDialogBrowsePath }),
    [createDialogBrowsePath],
  );

  const handleCreateDocument = useCallback(() => {
    const handle = username.trim();
    if (!handle || !onCreateDocument) return;
    // Freeze the sidebar drive at click time (path key stays "My Drive" / "Groups/…").
    const browsePath = resolveDocsHomeCreateDialogBrowsePath(browsePathPrefix ?? null);
    setCreateDialogBrowsePath(browsePath);
    const apiRoot = apiPathFromUiPath(browsePath, username, groupRootNames);
    void (async () => {
      const name = await resolveNewDocumentName(listingOperations, apiRoot, files);
      setCreateDialogDefaultName(name);
      setCreateDialogOpen(true);
    })();
  }, [browsePathPrefix, files, groupRootNames, listingOperations, onCreateDocument, username]);

  const closeCreateDialog = useCallback(() => {
    setCreateDialogOpen(false);
  }, []);

  const confirmCreateDocument = useCallback(
    (name: string, destinationPath: string) => {
      if (!onCreateDocument) return;
      const apiPath = docsHomeCreateDocumentApiPath(
        name,
        destinationPath,
        username,
        groupRootNames,
      );
      if (!apiPath) return;
      setCreateDialogOpen(false);
      onCreateDocument(apiPath);
    },
    [groupRootNames, onCreateDocument, username],
  );

  return {
    createDialogOpen,
    createDialogDefaultName,
    createDialogBrowsePath,
    createDialogView,
    handleCreateDocument,
    closeCreateDialog,
    confirmCreateDocument,
  };
}
