import adminIcon from "@/assets/app-icons/admin.svg?raw";
import homeIcon from "@/assets/app-icons/home.svg?raw";
import calendarIcon from "@/assets/app-icons/calendar.svg?raw";
import contactsIcon from "@/assets/app-icons/contacts.svg?raw";
import docsIcon from "@/assets/app-icons/docs.svg?raw";
import driveIcon from "@/assets/app-icons/drive.svg?raw";
import mailIcon from "@/assets/app-icons/mail.svg?raw";
import meetIcon from "@/assets/app-icons/meet.svg?raw";
import notesIcon from "@/assets/app-icons/notes.svg?raw";
import remindersIcon from "@/assets/app-icons/reminders.svg?raw";
import settingsIcon from "@/assets/app-icons/settings.svg?raw";
import tasksIcon from "@/assets/app-icons/tasks.svg?raw";
import type { WorkspaceAppId } from "@/lib/workspace-app-icons";

/** Inline SVG markup for switch-trigger recoloring via `--wai-*` CSS vars on the root `<svg>`. */
export const WORKSPACE_APP_ICON_INLINE: Record<WorkspaceAppId, string> = {
  admin: adminIcon,
  calendar: calendarIcon,
  contacts: contactsIcon,
  docs: docsIcon,
  drive: driveIcon,
  mail: mailIcon,
  meet: meetIcon,
  notes: notesIcon,
  settings: settingsIcon,
  tasks: tasksIcon,
};

export function workspaceAppIconInlineMarkup(appId: WorkspaceAppId): string {
  return WORKSPACE_APP_ICON_INLINE[appId];
}

/** Suite / workspace home shell icon — same `--wai-*` vars as app icons. */
export const WORKSPACE_HOME_ICON_INLINE = homeIcon;

/** Future icons — same source files, not wired in the home grid yet. */
export const WORKSPACE_FUTURE_APP_ICON_INLINE = {
  reminders: remindersIcon,
} as const;
