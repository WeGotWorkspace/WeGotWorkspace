import { useMemo, useState } from "react";
import type { SettingsWorkspaceProps } from "@/settings-core/src/settings-workspace-props";
import type { SettingsSection } from "@/settings-core/src/settings-types";
import {
  resolveSettingsSection,
  SETTINGS_DEFAULT_SECTION,
} from "@/settings-core/src/settings-section";
import { useSettingsMailForm } from "@/settings-core/src/use-settings-mail-form";
import { useSettingsMcpGrants } from "@/settings-core/src/use-settings-mcp-grants";
import { useSettingsProfileForm } from "@/settings-core/src/use-settings-profile-form";
import { useSettingsSidebarModel } from "@/settings-core/src/use-settings-sidebar-model";
import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";

/**
 * Settings workspace: section nav + sidebar visibility, plus independent profile and mail form
 * slices so each form hook can be reused outside this workspace.
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
  const sections = useSettingsSidebarModel(mcpEnabled);
  const isControlled = sectionProp !== undefined;
  const [internalSection, setInternalSection] = useState<SettingsSection>(() =>
    resolveSettingsSection(initialSection ?? SETTINGS_DEFAULT_SECTION, mcpEnabled),
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const section = resolveSettingsSection(isControlled ? sectionProp : internalSection, mcpEnabled);
  const currentSection = useMemo(
    () => sections.find((candidate) => candidate.id === section) ?? sections[0],
    [section, sections],
  );

  const selectSection = (nextSection: SettingsSection) => {
    const resolved = resolveSettingsSection(nextSection, mcpEnabled);
    if (!isControlled) {
      setInternalSection(resolved);
    }
    onSectionChange?.(resolved);
    if (isSidebarOverlayViewport()) {
      setSidebarOpen(false);
    }
  };

  const profile = useSettingsProfileForm({ user: data.user, operations });
  const mail = useSettingsMailForm({
    profileEmail: data.user.email,
    mail: data.mail,
    mailServer: data.mailServer,
    operations,
  });
  const assistants = useSettingsMcpGrants(operations, mcpEnabled);

  return {
    section,
    sections,
    currentSection,
    sidebarOpen,
    setSidebarOpen,
    selectSection,
    profile,
    memberships: data.groups,
    mail,
    assistants,
  };
}

export type SettingsControllerState = ReturnType<typeof useSettingsController>;
