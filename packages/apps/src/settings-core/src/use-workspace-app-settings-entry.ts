import { useCallback } from "react";
import type { WorkspaceAppSettingsEntry } from "@/lib/settings/app-settings-entry";
import type { WorkspaceAppId } from "@/lib/workspace-app-icons";
import { useSettingsDialog } from "@/settings-core/src/settings-dialog-context";
import { useSettingsReachability } from "@/settings-core/src/settings-reachability";
import { panelForApp } from "@/settings-core/src/settings-registry";

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
