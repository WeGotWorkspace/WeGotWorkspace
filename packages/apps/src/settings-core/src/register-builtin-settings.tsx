import { Bot, CalendarDays, HardDrive, Mail as MailIcon, User, Users } from "lucide-react";
import { SettingsAssistantsPane } from "@/settings-core/src/settings-assistants-pane";
import { SettingsCalendarPane } from "@/settings-core/src/settings-calendar-pane";
import { SettingsMailPane } from "@/settings-core/src/settings-mail-pane";
import { SettingsMembershipsPane } from "@/settings-core/src/settings-memberships-pane";
import { SettingsOfflinePane } from "@/settings-core/src/settings-offline-pane";
import { SettingsProfilePane } from "@/settings-core/src/settings-profile-pane";
import {
  markBuiltinSettingsRegistered,
  registerPanel,
  registerSlice,
} from "@/settings-core/src/settings-registry";

/** Idempotent. Call from the SPA shell and from story-scope — not a side-effect import. */
export function registerBuiltinSettings(): void {
  if (!markBuiltinSettingsRegistered()) return;

  registerPanel({
    id: "profile",
    label: "Profile",
    description: "Your account details",
    icon: <User className="size-3.5" />,
    group: "account",
  });
  registerPanel({
    id: "memberships",
    label: "Memberships",
    description: "Groups you belong to",
    icon: <Users className="size-3.5" />,
    group: "account",
  });
  registerPanel({
    id: "offline",
    label: "Offline",
    description: "Offline content sync on this device",
    icon: <HardDrive className="size-3.5" />,
    group: "account",
  });
  registerPanel({
    id: "assistants",
    label: "Connected assistants",
    description: "Assistants that can act as you",
    icon: <Bot className="size-3.5" />,
    group: "account",
    reachable: (ctx) => ctx.mcpEnabled === true,
  });
  registerPanel({
    id: "mail",
    label: "Mail",
    description: "IMAP & SMTP credentials",
    icon: <MailIcon className="size-3.5" />,
    group: "apps",
    appId: "mail",
  });
  registerPanel({
    id: "calendar",
    label: "Calendar",
    description: "Timezone, locale, and first day of week",
    icon: <CalendarDays className="size-3.5" />,
    group: "apps",
    appId: "calendar",
  });

  registerSlice({
    id: "profile",
    panelIds: ["profile"],
    render: (props) => <SettingsProfilePane profile={props.profile} />,
  });
  registerSlice({
    id: "memberships",
    panelIds: ["memberships"],
    render: (props) => <SettingsMembershipsPane groups={props.memberships} />,
  });
  registerSlice({
    id: "offline",
    panelIds: ["offline"],
    render: () => <SettingsOfflinePane />,
  });
  registerSlice({
    id: "assistants",
    panelIds: ["assistants"],
    render: (props) => <SettingsAssistantsPane assistants={props.assistants} />,
  });
  registerSlice({
    id: "mail-accounts",
    panelIds: ["mail"],
    render: () => <SettingsMailPane />,
  });
  registerSlice({
    id: "calendar-display",
    panelIds: ["calendar"],
    render: () => <SettingsCalendarPane />,
  });
}
