import {
  Activity,
  ArrowUpCircle,
  DatabaseBackup,
  FolderSync,
  MessagesSquare,
  Search,
  Send,
  Sparkles,
  Users,
} from "lucide-react";
import type { AdminSection } from "@/lib/models/admin-types";

/** Sidebar groups; the group title is also the header path (Admin › Services). */
export type AdminSectionGroup = "people" | "services" | "system";

export const ADMIN_GROUP_LABELS: Record<AdminSectionGroup, string> = {
  people: "People",
  services: "Services",
  system: "System",
};

export const ADMIN_GROUP_ORDER: readonly AdminSectionGroup[] = ["people", "services", "system"];

export type AdminSectionDescriptor = {
  id: AdminSection;
  group: AdminSectionGroup;
  label: string;
  /** Under the page title: what this page is for, in plain words. */
  description: string;
  icon: React.ReactNode;
};

const ADMIN_SECTIONS_MODEL: readonly AdminSectionDescriptor[] = [
  {
    id: "users",
    group: "people",
    label: "Users & Teams",
    description: "Who can sign in, and the Teams they share calendars, files and contacts with.",
    icon: <Users className="size-3.5" />,
  },
  {
    id: "email-delivery",
    group: "services",
    label: "Email delivery",
    description: "How this server sends password resets and invitations.",
    icon: <Send className="size-3.5" />,
  },
  {
    id: "collaboration",
    group: "services",
    label: "Real-time collaboration",
    description: "Connection servers and video quality for calls and live editing.",
    icon: <MessagesSquare className="size-3.5" />,
  },
  {
    id: "webdav",
    group: "services",
    label: "WebDAV",
    description: "Defaults for calendar, contacts and file sync apps.",
    icon: <FolderSync className="size-3.5" />,
  },
  {
    id: "mcp",
    group: "services",
    label: "Connected assistants",
    description: "Let people connect Claude, ChatGPT or Mistral to their workspace.",
    icon: <Sparkles className="size-3.5" />,
  },
  {
    id: "health",
    group: "system",
    label: "Health",
    description: "Security warnings and server checks for this install.",
    icon: <Activity className="size-3.5" />,
  },
  {
    id: "updates",
    group: "system",
    label: "Updates",
    description: "The installed version, new releases and the update log.",
    icon: <ArrowUpCircle className="size-3.5" />,
  },
  {
    id: "backups",
    group: "system",
    label: "Backups",
    description: "Database copies made before each update.",
    icon: <DatabaseBackup className="size-3.5" />,
  },
  {
    id: "search",
    group: "system",
    label: "Search",
    description: "The search index behind every app.",
    icon: <Search className="size-3.5" />,
  },
];

/**
 * Backups are the copies the web updater makes, so only ZIP installs have them. Docker and
 * Helm installs (`installChannel: "docker"`) upgrade on the host and back up there.
 */
export function adminHasBackups(installChannel: string | null | undefined): boolean {
  return installChannel !== "docker";
}

export function useAdminSidebarModel({
  installChannel,
}: {
  installChannel: string | null | undefined;
}): AdminSectionDescriptor[] {
  const backups = adminHasBackups(installChannel);
  return ADMIN_SECTIONS_MODEL.filter((section) => section.id !== "backups" || backups);
}
