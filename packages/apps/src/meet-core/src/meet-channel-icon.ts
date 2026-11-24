import { CalendarDays, FolderKanban, Hash, Users, type LucideIcon } from "lucide-react";
import { isTeamChat } from "@/meet-core/src/meet-channel-partition";
import { isProjectCollection } from "@/lib/projects/project-match";
import type { MeetChannel } from "@/lib/models/meet-types";

/**
 * The mark of a conversation, shared by its sidebar row and the main header: a meeting, a
 * Project channel, a Team chat, or a plain named channel. (A DM shows a presence dot.)
 */
export function meetChannelIcon(channel: MeetChannel): LucideIcon {
  if (channel.kind === "meeting") return CalendarDays;
  if (isProjectCollection(channel)) return FolderKanban;
  if (isTeamChat(channel)) return Users;
  return Hash;
}
