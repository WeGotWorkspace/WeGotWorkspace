import { CalendarDays, Hash, Mic, Pencil, Video } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { cn } from "@/lib/utils";
import { meetCallLiveIcon } from "@/meet-core/src/meet-call-live-icon";
import { SidebarSegmentedNewMenu } from "@/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu";
import { ViewHeader } from "@/view-header/src/view-header";
import { meetLabels } from "@/meet-core/src/meet-labels";
import type { MeetChannel } from "@/meet-core/src/meet-types";

export type MeetWorkspaceHeaderProps = {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  title: string;
  /** Selected channel, or null for a DM or an ad-hoc visit. */
  selected: MeetChannel | null;
  /** A conversation is open, so the action cluster belongs on screen. */
  conversationOpen: boolean;
  /** Start is offered only while no meeting is live here. */
  showStart: boolean;
  onStartCall: (options?: { video?: boolean }) => void;
  /**
   * A meeting is live here and this user is not in it: Join takes Meet's place,
   * with the same audio-only option. `audioOnly` marks an audio-only meeting.
   */
  join?: { audioOnly: boolean; onJoin: (options?: { video?: boolean }) => void } | null;
  onEditChannel: (channel: MeetChannel) => void;
};

/** Main header: conversation title with its edit button, plus Meet (or Join while live). */
export function MeetWorkspaceHeader({
  sidebarOpen,
  onToggleSidebar,
  title,
  selected,
  conversationOpen,
  showStart,
  onStartCall,
  join = null,
  onEditChannel,
}: MeetWorkspaceHeaderProps) {
  const MainIcon = join ? meetCallLiveIcon(join.audioOnly) : Video;
  return (
    <ViewHeader
      sidebarOpen={sidebarOpen}
      onToggleSidebar={onToggleSidebar}
      // A channel's # is its icon, as in the sidebar row; the heading is the name.
      title={selected && selected.kind !== "meeting" ? selected.name.toLowerCase() : title}
      titlePrefix={
        selected?.kind === "meeting" ? (
          <CalendarDays className="meet-workspace__header-kind-icon" aria-hidden />
        ) : selected ? (
          <Hash className="meet-workspace__header-kind-icon" aria-hidden />
        ) : null
      }
      // Edit sits on the name it changes, as rename in Docs.
      titleSuffix={
        conversationOpen && selected ? (
          <IconButton
            className="meet-workspace__header-edit"
            icon={<Pencil />}
            label={selected.kind === "meeting" ? meetLabels.editMeeting : meetLabels.editChannel}
            size="sm"
            variant="outline"
            onClick={() => onEditChannel(selected)}
          />
        ) : undefined
      }
      actions={
        conversationOpen && (showStart || join) ? (
          <div className="meet-workspace__header-actions">
            {/* Join takes Meet's place while a meeting is live: the same split button. */}
            <SidebarSegmentedNewMenu
              className={cn("meet-workspace__header-start", join && "meet-workspace__header-join")}
              mainLabel={join ? meetLabels.join : meetLabels.meet}
              menuLabel={meetLabels.startCallMenu}
              icon={<MainIcon />}
              size="md"
              stretch={false}
              onMainAction={() => (join ? join.onJoin() : onStartCall())}
              items={[
                {
                  id: "audio-only",
                  label: join ? meetLabels.joinAudioOnly : meetLabels.startAudioOnly,
                  icon: <Mic aria-hidden />,
                  onClick: () =>
                    join ? join.onJoin({ video: false }) : onStartCall({ video: false }),
                },
              ]}
            />
          </div>
        ) : null
      }
    />
  );
}
