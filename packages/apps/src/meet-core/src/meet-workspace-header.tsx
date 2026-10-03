import { CalendarDays, Mic, Pencil, Video } from "lucide-react";
import { IconButton } from "@/button/src/button";
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
  onEditChannel: (channel: MeetChannel) => void;
};

/** Main header: conversation title plus the start-call menu and the edit button. */
export function MeetWorkspaceHeader({
  sidebarOpen,
  onToggleSidebar,
  title,
  selected,
  conversationOpen,
  showStart,
  onStartCall,
  onEditChannel,
}: MeetWorkspaceHeaderProps) {
  return (
    <ViewHeader
      sidebarOpen={sidebarOpen}
      onToggleSidebar={onToggleSidebar}
      title={title}
      titlePrefix={
        selected?.kind === "meeting" ? (
          <CalendarDays className="meet-workspace__header-kind-icon" aria-hidden />
        ) : null
      }
      actions={
        conversationOpen ? (
          <div className="meet-workspace__header-actions">
            {showStart ? (
              <SidebarSegmentedNewMenu
                className="meet-workspace__header-start"
                mainLabel={meetLabels.meet}
                menuLabel={meetLabels.startCallMenu}
                icon={<Video />}
                size="md"
                stretch={false}
                onMainAction={() => onStartCall()}
                items={[
                  {
                    id: "audio-only",
                    label: meetLabels.startAudioOnly,
                    icon: <Mic aria-hidden />,
                    onClick: () => onStartCall({ video: false }),
                  },
                ]}
              />
            ) : null}
            {selected ? (
              <IconButton
                className="meet-workspace__header-edit"
                icon={<Pencil />}
                label={
                  selected.kind === "meeting" ? meetLabels.editMeeting : meetLabels.editChannel
                }
                size="md"
                variant="outline"
                onClick={() => onEditChannel(selected)}
              />
            ) : null}
          </div>
        ) : null
      }
    />
  );
}
