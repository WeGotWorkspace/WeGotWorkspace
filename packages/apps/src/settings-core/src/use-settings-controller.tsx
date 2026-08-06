import { useMemo, useState } from "react";
import type { SettingsWorkspaceProps } from "@/settings-core/src/settings-workspace-props";
import type { SettingsSection } from "@/settings-core/src/settings-types";
import { useSettingsMailForm } from "@/settings-core/src/use-settings-mail-form";
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
}: Pick<SettingsWorkspaceProps, "data" | "operations">) {
  const [section, setSection] = useState<SettingsSection>("profile");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const sections = useSettingsSidebarModel();
  const currentSection = useMemo(
    () => sections.find((candidate) => candidate.id === section) ?? sections[0],
    [section, sections],
  );

  const selectSection = (nextSection: SettingsSection) => {
    setSection(nextSection);
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
  };
}

export type SettingsControllerState = ReturnType<typeof useSettingsController>;
