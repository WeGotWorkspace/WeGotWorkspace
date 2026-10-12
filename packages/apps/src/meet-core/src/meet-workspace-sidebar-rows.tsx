import { CalendarDays } from "lucide-react";
import { CollectionSidebarRow } from "@/collection-sidebar/src/collection-sidebar-row";
import { UserAvatar, avatarColorForUserId } from "@/user-avatar/src/user-avatar";
import type { ChatAuthorPresenceMap } from "@/chat-ui/src/chat-types";
import { meetChannelHashName } from "@/meet-core/src/meet-channel-label";
import { DEFAULT_MEET_CHANNEL_COLOR } from "@/meet-core/src/meet-channel-write";
import {
  leftoverMeetingStartLabel,
  meetUpcomingAdHocRoom,
  type MeetUpcomingMeeting,
} from "@/meet-core/src/meet-calendar-meeting";
import { meetCallLiveIcon } from "@/meet-core/src/meet-call-live-icon";
import type { MeetDirectMessagePerson } from "@/meet-core/src/meet-direct-messages";
import { meetLabels } from "@/meet-core/src/meet-labels";
import type { MeetChannel } from "@/meet-core/src/meet-types";

function channelDotColor(channel: MeetChannel): string {
  return channel.color?.trim() || DEFAULT_MEET_CHANNEL_COLOR;
}

export function MeetSidebarRowMeta({
  live,
  audioOnly,
  unreadCount,
}: {
  live?: boolean;
  audioOnly?: boolean;
  unreadCount?: number;
}) {
  if (!live && !unreadCount) return undefined;
  const LiveIcon = meetCallLiveIcon(Boolean(audioOnly));
  return (
    <span className="meet-workspace__row-meta">
      {live ? (
        <span className="meet-workspace__live" role="img" aria-label={meetLabels.liveCall}>
          <LiveIcon className="meet-workspace__live-icon" aria-hidden />
        </span>
      ) : null}
      {unreadCount ? <span className="meet-workspace__unread">{unreadCount}</span> : null}
    </span>
  );
}

export function MeetDirectMessageRows({
  people,
  selectedId,
  authorPresence,
  onSelect,
  channelHasLiveCall,
  channelCallAudioOnly,
}: {
  people: MeetDirectMessagePerson[];
  selectedId: string | null;
  authorPresence?: ChatAuthorPresenceMap;
  onSelect: (channelId: string) => void;
  channelHasLiveCall: (channelId: string) => boolean;
  channelCallAudioOnly: (channelId: string) => boolean;
}) {
  return (
    <>
      {people.map((person) => (
        <CollectionSidebarRow
          key={person.id}
          name={person.displayName}
          color={DEFAULT_MEET_CHANNEL_COLOR}
          selected={selectedId === person.channelId}
          onSelect={() => onSelect(person.channelId)}
          leading={
            <UserAvatar
              displayName={person.displayName}
              compact
              size="xs"
              presence={authorPresence?.[person.id] ?? "offline"}
              color={avatarColorForUserId(person.id)}
            />
          }
          trailing={
            <MeetSidebarRowMeta
              live={channelHasLiveCall(person.channelId)}
              audioOnly={channelCallAudioOnly(person.channelId)}
              unreadCount={person.unreadCount}
            />
          }
        />
      ))}
    </>
  );
}

export function MeetUpcomingRows({
  meetings,
  onJoin,
  onEdit,
  editLabel,
  unmatchedRoom = null,
}: {
  meetings: MeetUpcomingMeeting[];
  onJoin?: (href: string) => void;
  onEdit?: (meeting: MeetUpcomingMeeting) => void;
  editLabel?: string;
  unmatchedRoom?: string | null;
}) {
  return (
    <>
      {meetings.map((meeting) => {
        const startLabel = leftoverMeetingStartLabel(meeting);
        return (
          <CollectionSidebarRow
            key={meeting.id}
            name={meeting.title}
            color={DEFAULT_MEET_CHANNEL_COLOR}
            selected={
              unmatchedRoom != null && meetUpcomingAdHocRoom(meeting.href) === unmatchedRoom
            }
            leading={<CalendarDays className="meet-workspace__sidebar-kind-icon" aria-hidden />}
            onSelect={() => onJoin?.(meeting.href)}
            onEdit={onEdit ? () => onEdit(meeting) : undefined}
            editLabel={editLabel}
            trailing={
              <span className="meet-workspace__upcoming-time" title={startLabel}>
                {startLabel}
              </span>
            }
          />
        );
      })}
    </>
  );
}

export function MeetSidebarRows({
  channels,
  selectedId,
  onSelect,
  channelHasLiveCall,
  channelCallAudioOnly,
  startLabelForChannel,
}: {
  channels: MeetChannel[];
  selectedId: string | null;
  onSelect: (channelId: string) => void;
  channelHasLiveCall: (channelId: string) => boolean;
  channelCallAudioOnly: (channelId: string) => boolean;
  startLabelForChannel?: (channel: MeetChannel) => string | null;
}) {
  return (
    <>
      {channels.map((channel) => {
        const startLabel = startLabelForChannel?.(channel) ?? null;
        return (
          <CollectionSidebarRow
            key={channel.id}
            name={meetChannelHashName(channel)}
            color={channelDotColor(channel)}
            selected={selectedId === channel.id}
            leading={
              channel.kind === "meeting" ? (
                <CalendarDays className="meet-workspace__sidebar-kind-icon" aria-hidden />
              ) : undefined
            }
            onSelect={() => onSelect(channel.id)}
            trailing={
              <>
                {startLabel ? (
                  <span className="meet-workspace__upcoming-time" title={startLabel}>
                    {startLabel}
                  </span>
                ) : null}
                <MeetSidebarRowMeta
                  live={channelHasLiveCall(channel.id)}
                  audioOnly={channelCallAudioOnly(channel.id)}
                  unreadCount={channel.unreadCount}
                />
              </>
            }
          />
        );
      })}
    </>
  );
}
