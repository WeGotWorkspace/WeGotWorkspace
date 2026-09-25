import { Bot, HardDrive, Mail as MailIcon, User, Users } from "lucide-react";
import { useMemo } from "react";
import type {
  SettingsSection,
  SettingsSectionDescriptor,
} from "@/settings-core/src/settings-types";

const SETTINGS_SIDEBAR_SECTIONS: Array<SettingsSectionDescriptor & { icon: React.ReactNode }> = [
  {
    id: "profile",
    label: "Profile",
    description: "Your account details",
    icon: <User className="size-3.5" />,
  },
  {
    id: "memberships",
    label: "Memberships",
    description: "Groups you belong to",
    icon: <Users className="size-3.5" />,
  },
  {
    id: "mail",
    label: "Mail",
    description: "IMAP & SMTP credentials",
    icon: <MailIcon className="size-3.5" />,
  },
  {
    id: "offline",
    label: "Offline",
    description: "Offline content sync on this device",
    icon: <HardDrive className="size-3.5" />,
  },
  {
    id: "assistants",
    label: "Connected assistants",
    description: "Assistants that can act as you",
    icon: <Bot className="size-3.5" />,
  },
];

export function settingsSectionDescriptor(
  id: SettingsSection,
): SettingsSectionDescriptor & { icon: React.ReactNode } {
  return (
    SETTINGS_SIDEBAR_SECTIONS.find((section) => section.id === id) ?? SETTINGS_SIDEBAR_SECTIONS[0]
  );
}

export function useSettingsSidebarModel(
  mcpEnabled: boolean,
): Array<SettingsSectionDescriptor & { icon: React.ReactNode }> {
  return useMemo(() => {
    return SETTINGS_SIDEBAR_SECTIONS.filter((section) => {
      if (section.id === "mail") return false;
      if (section.id === "assistants") return mcpEnabled;
      return true;
    });
  }, [mcpEnabled]);
}
