import {
  Bot,
  Bug,
  CalendarDays,
  CheckCircle2,
  Contact,
  FileText,
  HardDrive,
  Info,
  KeyRound,
  Mail,
  Palette,
  StickyNote,
  User,
  Users,
  Video,
} from "lucide-react";
import { SettingsAboutPane } from "@/settings-core/src/settings-about-pane";
import { SettingsAppearancePane } from "@/settings-core/src/settings-appearance-pane";
import { SettingsAssistantsPane } from "@/settings-core/src/settings-assistants-pane";
import { SettingsCalendarAvailabilitySection } from "@/settings-core/src/settings-calendar-availability-section";
import { SettingsCalendarReplyFolderSection } from "@/settings-core/src/settings-calendar-reply-folder-section";
import { SettingsCalendarPane } from "@/settings-core/src/settings-calendar-pane";
import {
  SettingsDiagnosticsPane,
  settingsDiagnosticsLabels,
} from "@/settings-core/src/settings-diagnostics-pane";
import { SettingsDocsPane } from "@/settings-core/src/settings-docs-pane";
import { docsPageSetupLabels } from "@/lib/docs-page-setup-labels";
import {
  SettingsContactsPane,
  SettingsNotesPane,
  SettingsTasksPane,
} from "@/settings-core/src/settings-default-collection-pane";
import { SettingsTasksNewTaskPane } from "@/settings-core/src/settings-tasks-new-task-pane";
import { SettingsIncomingEmailPane } from "@/settings-core/src/settings-incoming-email-pane";
import { incomingEmailLabels } from "@/settings-core/src/settings-incoming-email-labels";
import { SettingsMeetPane } from "@/settings-core/src/settings-meet-pane";
import { SettingsMembershipsPane } from "@/settings-core/src/settings-memberships-pane";
import { SettingsOfflinePane } from "@/settings-core/src/settings-offline-pane";
import { projectsLabels } from "@/projects-ui/src/projects-labels";
import { SettingsProfilePane } from "@/settings-core/src/settings-profile-pane";
import { SettingsSecurityPane } from "@/settings-core/src/settings-security-pane";
import { appPasswordLabels } from "@/settings-core/src/settings-app-passwords-labels";
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
    label: "Teams & Projects",
    description: projectsLabels.panelDescription,
    icon: <Users className="size-3.5" />,
    group: "account",
    needsSettingsApi: true,
  });
  registerPanel({
    id: "security",
    label: appPasswordLabels.panel,
    description: appPasswordLabels.panelDescription,
    icon: <KeyRound className="size-3.5" />,
    group: "account",
  });
  registerPanel({
    id: "offline",
    label: "Offline",
    description:
      "Offline content sync on this device. Calendar, Contacts, Notes and Tasks are always available offline.",
    icon: <HardDrive className="size-3.5" />,
    group: "device",
  });
  registerPanel({
    id: "appearance",
    label: "Appearance",
    description: "Light or dark theme on this device",
    icon: <Palette className="size-3.5" />,
    group: "device",
  });
  registerPanel({
    id: "assistants",
    label: "Connected assistants",
    description: "Assistants that can act as you",
    icon: <Bot className="size-3.5" />,
    group: "connections",
    reachable: (ctx) => ctx.mcpEnabled === true,
    needsSettingsApi: true,
  });
  registerPanel({
    id: "incoming-email",
    label: incomingEmailLabels.panel,
    description: incomingEmailLabels.panelDescription,
    icon: <Mail className="size-3.5" />,
    group: "connections",
  });
  registerPanel({
    id: "calendar",
    label: "Calendar",
    description: "Default calendar, timezone, first day of week, and availability",
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
    id: "docs",
    label: "Docs",
    description: docsPageSetupLabels.settingsDescription,
    icon: <FileText className="size-3.5" />,
    group: "apps",
    appId: "docs",
  });
  registerPanel({
    id: "meet",
    label: "Meet",
    description: "Low data mode on this device",
    icon: <Video className="size-3.5" />,
    group: "apps",
    appId: "meet",
  });
  registerPanel({
    id: "diagnostics",
    label: settingsDiagnosticsLabels.panel,
    description: settingsDiagnosticsLabels.panelDescription,
    icon: <Bug className="size-3.5" />,
    group: "device",
  });
  registerPanel({
    id: "about",
    label: "License",
    description: "License and source code",
    icon: <Info className="size-3.5" />,
    group: "about",
  });

  registerSlice({
    id: "profile",
    panelIds: ["profile"],
    render: (props) => <SettingsProfilePane profile={props.profile} />,
  });
  registerSlice({
    id: "memberships",
    panelIds: ["memberships"],
    render: (props) => (
      <SettingsMembershipsPane
        groups={props.memberships}
        currentUsername={props.profile.username}
      />
    ),
  });
  registerSlice({
    id: "security-app-passwords",
    panelIds: ["security"],
    render: () => <SettingsSecurityPane />,
  });
  registerSlice({
    id: "offline",
    panelIds: ["offline"],
    render: () => <SettingsOfflinePane />,
  });
  registerSlice({
    id: "incoming-email",
    panelIds: ["incoming-email"],
    render: () => <SettingsIncomingEmailPane />,
  });
  registerSlice({
    id: "appearance",
    panelIds: ["appearance"],
    render: () => <SettingsAppearancePane />,
  });
  registerSlice({
    id: "assistants",
    panelIds: ["assistants"],
    render: (props) => <SettingsAssistantsPane assistants={props.assistants} />,
  });
  registerSlice({
    id: "calendar-display",
    panelIds: ["calendar"],
    render: () => <SettingsCalendarPane />,
  });
  registerSlice({
    id: "calendar-reply-folder",
    panelIds: ["calendar"],
    render: () => <SettingsCalendarReplyFolderSection />,
  });
  registerSlice({
    id: "calendar-availability",
    panelIds: ["calendar"],
    render: () => <SettingsCalendarAvailabilitySection />,
  });
  registerSlice({
    id: "tasks-default-collection",
    panelIds: ["tasks"],
    render: () => <SettingsTasksPane />,
  });
  registerSlice({
    id: "tasks-new-task-defaults",
    panelIds: ["tasks"],
    render: () => <SettingsTasksNewTaskPane />,
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
    id: "docs-page-setup",
    panelIds: ["docs"],
    render: () => <SettingsDocsPane />,
  });
  registerSlice({
    id: "meet-device",
    panelIds: ["meet"],
    render: () => <SettingsMeetPane />,
  });
  registerSlice({
    id: "diagnostics",
    panelIds: ["diagnostics"],
    render: () => <SettingsDiagnosticsPane />,
  });
  registerSlice({
    id: "about",
    panelIds: ["about"],
    render: () => <SettingsAboutPane />,
  });
}
