import type { WorkspaceAppId } from "@/lib/workspace-app-icons";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { useWorkspaceAppSettingsEntry } from "@/settings-core/src/use-workspace-app-settings-entry";
import { WorkspaceSidebarAccountFooter } from "@/workspace-shell/src/workspace-app-layout";

export function WorkspaceAppSettingsFooter({
  appId,
  session,
  onLogout,
  detailLine,
  onBeforeOpen,
}: {
  appId: WorkspaceAppId;
  session: WorkspaceSession;
  onLogout?: () => void;
  detailLine?: string;
  onBeforeOpen?: () => void;
}) {
  const settingsItem = useWorkspaceAppSettingsEntry(appId);
  return (
    <WorkspaceSidebarAccountFooter
      session={session}
      onLogout={onLogout}
      detailLine={detailLine}
      settingsItem={
        settingsItem.visible
          ? {
              label: settingsItem.label,
              onClick: () => {
                onBeforeOpen?.();
                settingsItem.onClick();
              },
            }
          : undefined
      }
    />
  );
}
