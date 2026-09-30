import { useCallback } from "react";
import type { WorkspaceAppId } from "@/lib/workspace-app-icons";
import { useSettingsDialog } from "@/settings-core/src/settings-dialog-provider";
import { useSettingsReachability } from "@/settings-core/src/settings-reachability";
import { panelForApp } from "@/settings-core/src/settings-registry";

export type WorkspaceAppSettingsEntry = {
  visible: boolean;
  onClick: () => void;
  label: string;
};

export function useWorkspaceAppSettingsEntry(appId: WorkspaceAppId): WorkspaceAppSettingsEntry {
  const ctx = useSettingsReachability();
  const dialog = useSettingsDialog();
  const panel = panelForApp(appId, ctx);
  const onClick = useCallback(() => {
    if (!panel) return;
    dialog.openRegisteredPanel(panel);
  }, [dialog, panel]);

  return {
    visible: panel !== undefined,
    onClick,
    label: "Settings",
  };
}
