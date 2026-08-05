import { useCallback, useState } from "react";
import type { DriveShareOperations } from "@/drive-core/src/drive-types";
import { isTopLevelDriveApiPath } from "@/drive-core/src/drive-path-utils";

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
  username: _username,
}: UseDriveShareDialogArgs) {
  const [shareDialog, setShareDialog] = useState<DriveShareDialogState>({
    open: false,
    path: "",
    title: "",
  });

  const openShareDialog = useCallback((apiPath: string, title?: string) => {
    if (isTopLevelDriveApiPath(apiPath)) return;
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

  return {
    shareDialog,
    openShareDialog,
    handleShareDialogOpenChange,
  };
}
