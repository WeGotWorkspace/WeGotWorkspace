import { Hash, Video } from "lucide-react";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { SidebarSegmentedNewMenu } from "@/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu";
import { WorkspaceAppSettingsFooter } from "@/settings-core/src/workspace-app-settings-footer";
import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";
import type { ChatAuthorPresenceMap } from "@/chat-ui/src/chat-types";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type { MeetUpcomingMeeting } from "@/meet-core/src/meet-calendar-meeting";
import type { MeetChannelSections } from "@/meet-core/src/meet-channel-partition";
import type { MeetDirectMessagePerson } from "@/meet-core/src/meet-direct-messages";
import { meetLabels } from "@/meet-core/src/meet-labels";
import type { MeetChannel } from "@/meet-core/src/meet-types";
import {
  MeetDirectMessageRows,
  MeetSidebarRows,
  MeetUpcomingRows,
} from "@/meet-core/src/meet-workspace-sidebar-rows";

export type MeetWorkspaceSidebarProps = {
  open: boolean;
  onClose: () => void;
  session: WorkspaceSession;
  onLogout?: () => void;
  sections: MeetChannelSections;
  /** Owned meeting channels that belong in today's sidebar, already filtered. */
  todayMeetings: MeetChannel[];
  /** Calendar meetings without a channel of their own. */
  leftoverUpcoming: MeetUpcomingMeeting[];
  directMessagePeople: MeetDirectMessagePerson[];
  selectedId: string | null;
  onSelect: (channelId: string) => void;
  authorPresence?: ChatAuthorPresenceMap;
  unmatchedAdHocRoom?: string | null;
  channelHasLiveCall: (channelId: string) => boolean;
  channelCallAudioOnly: (channelId: string) => boolean;
  meetingStartLabel: (channel: MeetChannel) => string | null;
  onCreateChannel: () => void;
  onCreateMeeting: () => void;
  onJoinUpcomingMeeting?: (href: string) => void;
  onEditUpcomingMeeting?: (meeting: MeetUpcomingMeeting) => void;
};

/** Left sidebar: new-meeting menu, channel/meeting/DM sections, settings footer. */
export function MeetWorkspaceSidebar({
  open,
  onClose,
  session,
  onLogout,
  sections,
  todayMeetings,
  leftoverUpcoming,
  directMessagePeople,
  selectedId,
  onSelect,
  authorPresence,
  unmatchedAdHocRoom = null,
  channelHasLiveCall,
  channelCallAudioOnly,
  meetingStartLabel,
  onCreateChannel,
  onCreateMeeting,
  onJoinUpcomingMeeting,
  onEditUpcomingMeeting,
}: MeetWorkspaceSidebarProps) {
  return (
    <AppSidebar
      open={open}
      onCloseMobile={onClose}
      appSwitchSubtitle={meetLabels.productName}
      primaryButton={
        <SidebarSegmentedNewMenu
          mainLabel={meetLabels.newMeeting}
          menuLabel={meetLabels.newChannelMenu}
          icon={<Video />}
          onMainAction={onCreateMeeting}
          items={[
            {
              id: "create-channel",
              label: meetLabels.newChannel,
              icon: <Hash aria-hidden />,
              onClick: onCreateChannel,
            },
          ]}
        />
      }
      footer={
        <WorkspaceAppSettingsFooter
          appId="meet"
          session={session}
          onLogout={onLogout}
          onBeforeOpen={() => {
            if (isSidebarOverlayViewport()) onClose();
          }}
        />
      }
    >
      {sections.channels.length > 0 ? (
        <SidebarSection title={meetLabels.sidebarChannels}>
          <MeetSidebarRows
            channels={sections.channels}
            selectedId={selectedId}
            onSelect={onSelect}
            channelHasLiveCall={channelHasLiveCall}
            channelCallAudioOnly={channelCallAudioOnly}
          />
        </SidebarSection>
      ) : null}
      {sections.shared.length > 0 ? (
        <SidebarSection title={meetLabels.sidebarSharedWithMe}>
          <MeetSidebarRows
            channels={sections.shared}
            selectedId={selectedId}
            onSelect={onSelect}
            channelHasLiveCall={channelHasLiveCall}
            channelCallAudioOnly={channelCallAudioOnly}
          />
        </SidebarSection>
      ) : null}
      {todayMeetings.length > 0 || leftoverUpcoming.length > 0 ? (
        <SidebarSection title={meetLabels.sidebarMeetings}>
          {todayMeetings.length > 0 ? (
            <MeetSidebarRows
              channels={todayMeetings}
              selectedId={selectedId}
              onSelect={onSelect}
              channelHasLiveCall={channelHasLiveCall}
              channelCallAudioOnly={channelCallAudioOnly}
              startLabelForChannel={meetingStartLabel}
            />
          ) : null}
          {leftoverUpcoming.length > 0 ? (
            <MeetUpcomingRows
              meetings={leftoverUpcoming}
              unmatchedRoom={unmatchedAdHocRoom}
              onJoin={onJoinUpcomingMeeting}
              onEdit={onEditUpcomingMeeting}
              editLabel={meetLabels.editMeeting}
            />
          ) : null}
        </SidebarSection>
      ) : null}
      {directMessagePeople.length > 0 ? (
        <SidebarSection title={meetLabels.sidebarDirectMessages}>
          <MeetDirectMessageRows
            people={directMessagePeople}
            selectedId={selectedId}
            authorPresence={authorPresence}
            onSelect={onSelect}
            channelHasLiveCall={channelHasLiveCall}
            channelCallAudioOnly={channelCallAudioOnly}
          />
        </SidebarSection>
      ) : null}
    </AppSidebar>
  );
}
