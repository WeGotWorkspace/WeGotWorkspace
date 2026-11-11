import { useCallback, useState } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import { useConnectivity } from "@/hooks/use-connectivity";
import type { ActionBarAction } from "@/action-bar/src/action-bar";
import type { DriveFile } from "@/lib/files/drive-models";
import { driveLabels } from "@/drive-core/src/drive-labels";
import {
  DriveOfflineAvailableIcon,
  DriveOfflineRemoveIcon,
} from "@/drive-core/src/drive-offline-icons";
import {
  makeDriveOfflineAvailable,
  removeDriveOfflineCopy,
} from "@/lib/offline/drive/drive-offline-pin-core";

type UseDriveOfflineFileActionsOptions = {
  username: string | null | undefined;
  offlineAvailableIds?: ReadonlySet<string>;
  onChanged?: () => void;
};

export function useDriveOfflineFileActions({
  username,
  offlineAvailableIds,
  onChanged,
}: UseDriveOfflineFileActionsOptions): {
  extraFileActions: (file: DriveFile) => ActionBarAction[];
  pinOfflineFile: (file: DriveFile) => Promise<void>;
  removeOfflineFile: (file: DriveFile) => Promise<void>;
  pinLoadingId: string | null;
} {
  const { online } = useConnectivity();
  const { showError, show } = useAppToast();
  const [pinLoadingId, setPinLoadingId] = useState<string | null>(null);

  const pinOfflineFile = useCallback(
    async (file: DriveFile) => {
      if (!username || file.kind === "folder" || !file.apiPath) return;
      if (!online) {
        showError("Connect to the network to make files available offline.");
        return;
      }
      setPinLoadingId(file.apiPath);
      try {
        await makeDriveOfflineAvailable(username, file.apiPath);
        show("File saved for offline use");
        onChanged?.();
      } catch (error) {
        showError(error instanceof Error ? error.message : String(error));
      } finally {
        setPinLoadingId((current) => (current === file.apiPath ? null : current));
      }
    },
    [onChanged, online, show, showError, username],
  );

  const removeOfflineFile = useCallback(
    async (file: DriveFile) => {
      if (!username || file.kind === "folder" || !file.apiPath) return;
      try {
        await removeDriveOfflineCopy(username, file.apiPath);
        show("Offline copy removed");
        onChanged?.();
      } catch (error) {
        showError(error instanceof Error ? error.message : String(error));
      }
    },
    [onChanged, show, showError, username],
  );

  const extraFileActions = useCallback(
    (file: DriveFile): ActionBarAction[] => {
      if (!username || file.kind === "folder" || !file.apiPath) return [];

      const actions: ActionBarAction[] = [];
      const hasLocalCopy = offlineAvailableIds?.has(file.id) ?? false;

      if (online && !hasLocalCopy) {
        actions.push({
          label: driveLabels.offlineMakeAvailable,
          icon: <DriveOfflineAvailableIcon />,
          onClick: () => {
            void pinOfflineFile(file);
          },
        });
      }

      if (hasLocalCopy) {
        actions.push({
          label: driveLabels.offlineRemoveCopy,
          icon: <DriveOfflineRemoveIcon />,
          onClick: () => {
            void removeOfflineFile(file);
          },
        });
      }

      return actions;
    },
    [offlineAvailableIds, online, pinOfflineFile, removeOfflineFile, username],
  );

  return { extraFileActions, pinOfflineFile, removeOfflineFile, pinLoadingId };
}
