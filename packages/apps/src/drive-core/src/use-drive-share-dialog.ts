import { useCallback, useState } from "react";
import { openDriveAccessInNewWindow } from "@/drive-core/src/drive-route-search";
import type { DriveShareOperations } from "@/drive-core/src/drive-types";
import { uiPathFromApiPath } from "@/drive-core/src/drive-path-utils";

export type DriveShareDialogState = {
  open: boolean;
  path: string;
  title: string;
};

function titleFromApiPath(apiPath: string): string {
  const segments = apiPath.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? apiPath;
}

export type UseDriveShareDialogArgs = {
  shareOperations?: DriveShareOperations;
  username: string;
};

export function useDriveShareDialog({
  shareOperations: _shareOperations,
  username,
}: UseDriveShareDialogArgs) {
  const [shareDialog, setShareDialog] = useState<DriveShareDialogState>({
    open: false,
    path: "",
    title: "",
  });

  const openShareDialog = useCallback((apiPath: string, title?: string) => {
    const path = apiPath.trim();
    if (!path) return;
    setShareDialog({
      open: true,
      path,
      title: title?.trim() || titleFromApiPath(path),
    });
  }, []);

  const handleShareDialogOpenChange = useCallback((open: boolean) => {
    setShareDialog((prev) => ({ ...prev, open }));
  }, []);

  const handleShareDialogOpenAccess = useCallback(
    (apiPath: string) => {
      const path = apiPath.trim();
      if (!path) return;
      setShareDialog((prev) => ({ ...prev, open: false }));
      const scopePath = uiPathFromApiPath(path, username);
      openDriveAccessInNewWindow(scopePath);
    },
    [username],
  );

  return {
    shareDialog,
    openShareDialog,
    handleShareDialogOpenChange,
    handleShareDialogOpenAccess,
  };
}
