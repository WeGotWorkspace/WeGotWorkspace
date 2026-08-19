import type { AdminWorkspaceProps } from "@/admin-core/src/admin-workspace-props";
import { useAdminMutations } from "@/admin-core/src/use-admin-mutations";
import { useAdminShell } from "@/admin-core/src/use-admin-shell";

/**
 * Admin workspace controller: composes shell navigation/state and mutation slices.
 * See useAdminShell and useAdminMutations for domain-specific state.
 */
export function useAdminController({
  data,
  operations,
}: Pick<AdminWorkspaceProps, "data" | "operations">) {
  const shell = useAdminShell({ data, operations });
  const mutations = useAdminMutations({ operations, shell });

  return {
    section: shell.section,
    sections: shell.sections,
    currentSection: shell.currentSection,
    sidebarOpen: shell.sidebarOpen,
    setSidebarOpen: shell.setSidebarOpen,
    selectSection: shell.selectSection,
    users: shell.users,
    groups: shell.groups,
    plugins: shell.plugins,
    updates: shell.updates,
    searchReindex: shell.searchReindex,
    updateLogLines: shell.updateLogLines,
    checkingUpdates: mutations.checkingUpdates,
    refreshingServerChecks: mutations.refreshingServerChecks,
    settingsForm: shell.settingsForm,
    setSettingsForm: shell.setSettingsForm,
    mailDelivery: shell.mailDelivery,
    actions: mutations.actions,
  };
}

export type AdminControllerState = ReturnType<typeof useAdminController>;
