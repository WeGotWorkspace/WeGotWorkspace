import {
  Bot,
  CalendarDays,
  CheckCircle2,
  Contact,
  HardDrive,
  Mail as MailIcon,
  StickyNote,
  User,
  Users,
  Video,
} from "lucide-react";
import { SettingsAssistantsPane } from "@/settings-core/src/settings-assistants-pane";
import { SettingsCalendarPane } from "@/settings-core/src/settings-calendar-pane";
import {
  SettingsContactsPane,
  SettingsNotesPane,
  SettingsTasksPane,
} from "@/settings-core/src/settings-default-collection-pane";
import { SettingsMailPane } from "@/settings-core/src/settings-mail-pane";
import { SettingsMeetPane } from "@/settings-core/src/settings-meet-pane";
import { SettingsMembershipsPane } from "@/settings-core/src/settings-memberships-pane";
import { SettingsOfflinePane } from "@/settings-core/src/settings-offline-pane";
import { SettingsProfilePane } from "@/settings-core/src/settings-profile-pane";
import { DEFAULT_COLLECTION_APP_META } from "@/lib/default-collection-prefs";
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
    needsSettingsApi: true,
  });
  registerPanel({
    id: "memberships",
    label: "Memberships",
    description: "Groups you belong to",
    icon: <Users className="size-3.5" />,
    group: "account",
    needsSettingsApi: true,
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
    needsSettingsApi: true,
  });
  registerPanel({
    id: "mail",
    label: "Mail",
    description: "IMAP & SMTP credentials",
    icon: <MailIcon className="size-3.5" />,
    group: "apps",
    appId: "mail",
    showInNav: false,
  });
  registerPanel({
    id: "calendar",
    label: "Calendar",
    description: "Default calendar, timezone, and first day of week",
    icon: <CalendarDays className="size-3.5" />,
    group: "apps",
    appId: "calendar",
  });
  registerPanel({
    id: "tasks",
    label: DEFAULT_COLLECTION_APP_META.tasks.label,
    description: DEFAULT_COLLECTION_APP_META.tasks.description,
    icon: <CheckCircle2 className="size-3.5" />,
    group: "apps",
    appId: "tasks",
  });
  registerPanel({
    id: "contacts",
    label: DEFAULT_COLLECTION_APP_META.contacts.label,
    description: DEFAULT_COLLECTION_APP_META.contacts.description,
    icon: <Contact className="size-3.5" />,
    group: "apps",
    appId: "contacts",
  });
  registerPanel({
    id: "notes",
    label: DEFAULT_COLLECTION_APP_META.notes.label,
    description: DEFAULT_COLLECTION_APP_META.notes.description,
    icon: <StickyNote className="size-3.5" />,
    group: "apps",
    appId: "notes",
  });
  registerPanel({
    id: "meet",
    label: "Meet",
    description: "Low data mode on this device",
    icon: <Video className="size-3.5" />,
    group: "apps",
    appId: "meet",
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
  registerSlice({
    id: "tasks-default-collection",
    panelIds: ["tasks"],
    render: () => <SettingsTasksPane />,
  });
  registerSlice({
    id: "contacts-default-collection",
    panelIds: ["contacts"],
    render: () => <SettingsContactsPane />,
  });
  registerSlice({
    id: "notes-default-collection",
    panelIds: ["notes"],
    render: () => <SettingsNotesPane />,
  });
  registerSlice({
    id: "meet-device",
    panelIds: ["meet"],
    render: () => <SettingsMeetPane />,
  });
}
