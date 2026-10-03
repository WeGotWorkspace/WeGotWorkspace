import { useState, type Dispatch, type SetStateAction } from "react";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import {
  calendarEventsForMeetingChannel,
  preferredCalendarEventForMeeting,
  type MeetUpcomingMeeting,
} from "@/meet-core/src/meet-calendar-meeting";
import type { MeetChannelDialogState } from "@/meet-core/src/meet-channel-dialog";
import { canDeleteMeetChannel } from "@/meet-core/src/meet-channel-write";
import type { MeetChannel, MeetChannelKind, MeetChatOperations } from "@/meet-core/src/meet-types";
import type { MeetCalendarSlice } from "@/meet-core/src/meet-workspace-props";

/** Meeting dialog target: a meeting channel, or a calendar row without a channel of its own. */
export type MeetMeetingEditTarget = {
  channel?: MeetChannel;
  event?: JmapCalendarEvent | null;
  leftover?: MeetUpcomingMeeting;
};

export type MeetChannelDialogs = {
  dialog: MeetChannelDialogState;
  setDialog: Dispatch<SetStateAction<MeetChannelDialogState>>;
  createMeetingOpen: boolean;
  setCreateMeetingOpen: Dispatch<SetStateAction<boolean>>;
  editMeeting: MeetMeetingEditTarget | null;
  setEditMeeting: Dispatch<SetStateAction<MeetMeetingEditTarget | null>>;
  pendingUpcomingDelete: MeetUpcomingMeeting | null;
  setPendingUpcomingDelete: Dispatch<SetStateAction<MeetUpcomingMeeting | null>>;
  pendingMeetingChannelDelete: string | null;
  setPendingMeetingChannelDelete: Dispatch<SetStateAction<string | null>>;
  openCreate: (kind: MeetChannelKind) => void;
  /** Channels open the channel dialog; meetings open the meeting dialog on their calendar event. */
  openEdit: (channel: MeetChannel) => void;
  openEditLeftover: (meeting: MeetUpcomingMeeting) => void;
};

/** Which Meet workspace dialog is open and what it targets. Writes live in `useMeetChannelActions`. */
export function useMeetChannelDialogs({
  channels,
  calendar,
  operations,
}: {
  channels: MeetChannel[];
  calendar?: MeetCalendarSlice;
  operations?: MeetChatOperations;
}): MeetChannelDialogs {
  const [dialog, setDialog] = useState<MeetChannelDialogState>(null);
  const [pendingUpcomingDelete, setPendingUpcomingDelete] = useState<MeetUpcomingMeeting | null>(
    null,
  );
  const [createMeetingOpen, setCreateMeetingOpen] = useState(false);
  const [editMeeting, setEditMeeting] = useState<MeetMeetingEditTarget | null>(null);
  const [pendingMeetingChannelDelete, setPendingMeetingChannelDelete] = useState<string | null>(
    null,
  );

  const openCreate = (kind: MeetChannelKind) => {
    setDialog({ mode: "create", kind });
  };

  const openEdit = (channel: MeetChannel) => {
    if (channel.kind === "meeting") {
      const origin = calendar?.workspaceOrigin ?? "";
      const matches = calendarEventsForMeetingChannel(
        calendar?.events ?? [],
        channel,
        origin,
        channels,
      );
      setEditMeeting({
        channel,
        event: preferredCalendarEventForMeeting(matches),
      });
      return;
    }
    setDialog({
      mode: "edit",
      channelId: channel.id,
      name: channel.name,
      kind: channel.kind,
      scope: channel.scope,
      groupSlug: channel.groupSlug ?? null,
      mayShare: channel.myRights?.mayShare !== false && !channel.isSharee,
      isSharee: channel.isSharee,
      shareWith: channel.shareWith,
      canChangeOwner: !channel.isSharee,
      guestRoomCode: channel.guestRoomCode,
      mayDelete: canDeleteMeetChannel(channel) && Boolean(operations?.deleteChannel),
    });
  };

  const openEditLeftover = (meeting: MeetUpcomingMeeting) => {
    const event = calendar?.events?.find((row) => row.id === meeting.id) ?? null;
    setEditMeeting({ leftover: meeting, event });
  };

  return {
    dialog,
    setDialog,
    createMeetingOpen,
    setCreateMeetingOpen,
    editMeeting,
    setEditMeeting,
    pendingUpcomingDelete,
    setPendingUpcomingDelete,
    pendingMeetingChannelDelete,
    setPendingMeetingChannelDelete,
    openCreate,
    openEdit,
    openEditLeftover,
  };
}
