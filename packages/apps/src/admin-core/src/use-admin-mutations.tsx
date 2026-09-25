import { useAppToast } from "@/hooks/use-app-toast";
import type { AdminWorkspaceProps } from "@/admin-core/src/admin-workspace-props";
import type { AdminShellState } from "@/admin-core/src/use-admin-shell";
import { useAdminBackupMutations } from "@/admin-core/src/use-admin-backup-mutations";
import { useAdminGroupMutations } from "@/admin-core/src/use-admin-group-mutations";
import { useAdminPluginMutations } from "@/admin-core/src/use-admin-plugin-mutations";
import { useAdminSearchMutations } from "@/admin-core/src/use-admin-search-mutations";
import { useAdminSettingsMutations } from "@/admin-core/src/use-admin-settings-mutations";
import { useAdminStateRefresh } from "@/admin-core/src/use-admin-state-refresh";
import { useAdminUpdateMutations } from "@/admin-core/src/use-admin-update-mutations";
import { useAdminUserMutations } from "@/admin-core/src/use-admin-user-mutations";

export type UseAdminMutationsArgs = {
  operations?: AdminWorkspaceProps["operations"];
  shell: AdminShellState;
};

/** Wires admin mutation slices. Each slice owns one settings, maintenance, or directory concern. */
export function useAdminMutations({ operations, shell }: UseAdminMutationsArgs) {
  const { showSuccess, showError } = useAppToast();
  const toast = { showSuccess, showError };
  const settings = useAdminSettingsMutations({ operations, shell, ...toast });
  const { refresh } = useAdminStateRefresh({ operations, shell, ...toast });
  const updates = useAdminUpdateMutations({ operations, shell, ...toast });
  const backups = useAdminBackupMutations({ operations, shell, ...toast });
  const search = useAdminSearchMutations({ operations, shell, ...toast });
  const users = useAdminUserMutations({ operations, shell, ...toast });
  const groups = useAdminGroupMutations({ operations, shell, ...toast });
  const plugins = useAdminPluginMutations({ operations, shell, ...toast });

  return {
    checkingUpdates: updates.checkingUpdates,
    refreshingServerChecks: updates.refreshingServerChecks,
    actions: {
      saveSettings: settings.saveSettings,
      clearMailDeliverySmtpPassword: settings.clearMailDeliverySmtpPassword,
      sendMailDeliveryTest: settings.sendMailDeliveryTest,
      refresh,
      checkUpdates: updates.checkUpdates,
      refreshServerChecks: updates.refreshServerChecks,
      clearUpdateLog: updates.clearUpdateLog,
      refreshUpdateLog: updates.refreshUpdateLog,
      downloadUpdateLog: updates.downloadUpdateLog,
      deleteBackup: backups.deleteBackup,
      createBackup: backups.createBackup,
      downloadBackup: backups.downloadBackup,
      applyUpdate: updates.applyUpdate,
      cancelUpdate: updates.cancelUpdate,
      startSearchReindex: search.startSearchReindex,
      refreshSearchReindexState: search.refreshSearchReindexState,
      cancelSearchReindex: search.cancelSearchReindex,
      createUser: users.createUser,
      updateUser: users.updateUser,
      setUserEnabled: users.setUserEnabled,
      deleteUser: users.deleteUser,
      updateUserPassword: users.updateUserPassword,
      createGroup: groups.createGroup,
      updateGroup: groups.updateGroup,
      deleteGroup: groups.deleteGroup,
      setPluginActive: plugins.setPluginActive,
      installPluginZip: plugins.installPluginZip,
    },
  };
}

export type AdminMutationsState = ReturnType<typeof useAdminMutations>;
