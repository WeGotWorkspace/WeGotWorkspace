import { useMemo, useState } from "react";
import type { SettingsWorkspaceProps } from "@/settings-core/src/settings-workspace-props";
import type { SettingsPanelId } from "@/settings-core/src/settings-types";
import {
  resolveSettingsSection,
  SETTINGS_DEFAULT_SECTION,
} from "@/settings-core/src/settings-section";
import { useSettingsMcpGrants } from "@/settings-core/src/use-settings-mcp-grants";
import { useSettingsProfileForm } from "@/settings-core/src/use-settings-profile-form";
import {
  settingsSectionDescriptor,
  useSettingsSidebarModel,
} from "@/settings-core/src/use-settings-sidebar-model";
import { dismissSidebarOverlay } from "@/workspace-shell/src/sidebar-breakpoint";

/**
 * Settings workspace: section nav + sidebar visibility, plus an independent profile form
 * slice so the form hook can be reused outside this workspace.
 */
export function useSettingsController({
  data,
  operations,
  section: sectionProp,
  initialSection,
  onSectionChange,
}: Pick<
  SettingsWorkspaceProps,
  "data" | "operations" | "section" | "initialSection" | "onSectionChange"
>) {
  const mcpEnabled = data.mcpEnabled;
  const sidebarGroups = useSettingsSidebarModel(mcpEnabled);
  const isControlled = sectionProp !== undefined;
  const [internalSection, setInternalSection] = useState<SettingsPanelId>(() =>
    resolveSettingsSection(initialSection ?? SETTINGS_DEFAULT_SECTION, mcpEnabled),
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const section = resolveSettingsSection(isControlled ? sectionProp : internalSection, mcpEnabled);
  const currentSection = useMemo(() => settingsSectionDescriptor(section), [section]);

  const selectSection = (nextSection: SettingsPanelId) => {
    const resolved = resolveSettingsSection(nextSection, mcpEnabled);
    if (!isControlled) {
      setInternalSection(resolved);
    }
    onSectionChange?.(resolved);
    dismissSidebarOverlay(() => setSidebarOpen(false));
  };

  const profile = useSettingsProfileForm({ user: data.user, operations });
  const assistants = useSettingsMcpGrants(operations, mcpEnabled);

  return {
    section,
    sidebarGroups,
    currentSection,
    sidebarOpen,
    setSidebarOpen,
    selectSection,
    profile,
    memberships: data.groups,
    assistants,
    mcpEnabled,
  };
}

export type SettingsControllerState = ReturnType<typeof useSettingsController>;
