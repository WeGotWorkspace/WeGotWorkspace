import {
  DatabaseBackup,
  Database,
  Search,
  Mail,
  Send,
  MessagesSquare,
  Puzzle,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { AdminSection } from "@/admin-core/src/admin-types";

export type AdminSectionDescriptor = {
  id: AdminSection;
  label: string;
  description: string;
  icon: React.ReactNode;
};

export function useAdminSidebarModel(): AdminSectionDescriptor[] {
  return [
    {
      id: "users",
      label: "Users & Groups",
      description: "Directory principals and memberships",
      icon: <Users className="size-3.5" />,
    },
    {
      id: "mail",
      label: "Mail",
      description: "Server IMAP/SMTP settings",
      icon: <Mail className="size-3.5" />,
    },
    {
      id: "email-delivery",
      label: "Email delivery",
      description: "Platform outbound mail for recovery and invites",
      icon: <Send className="size-3.5" />,
    },
    {
      id: "collaboration",
      label: "Real-time collaboration",
      description: "WebRTC STUN/TURN and relay routing",
      icon: <MessagesSquare className="size-3.5" />,
    },
    {
      id: "webdav",
      label: "WebDAV",
      description: "Core platform and app toggles",
      icon: <ShieldCheck className="size-3.5" />,
    },
    {
      id: "plugins",
      label: "Plugins",
      description: "Optional app integrations",
      icon: <Puzzle className="size-3.5" />,
    },
    {
      id: "backups",
      label: "Backups",
      description: "Database and system backups",
      icon: <DatabaseBackup className="size-3.5" />,
    },
    {
      id: "updates",
      label: "Updates",
      description: "Checks, release status, and logs",
      icon: <Database className="size-3.5" />,
    },
    {
      id: "search",
      label: "Search",
      description: "Unified index health and reindexing",
      icon: <Search className="size-3.5" />,
    },
  ];
}
