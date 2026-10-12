import type { Dispatch, SetStateAction } from "react";
import { mergeShareWith } from "@/share-ui/collection-share";
import type { CollectionShareWith } from "@/share-ui/collection-share";
import {
  calendarEventsForMeetingChannel,
  upcomingEventIdsForChannel,
  type MeetUpcomingMeeting,
} from "@/meet-core/src/meet-calendar-meeting";
import type { MeetChannelDialogConfirmInput } from "@/meet-core/src/meet-channel-dialog";
import {
  applyMeetChannelPatch,
  buildMeetChannel,
  canDeleteMeetChannel,
} from "@/meet-core/src/meet-channel-write";
import type { MeetChannel, MeetChatOperations } from "@/meet-core/src/meet-types";
import type { MeetCalendarSlice } from "@/meet-core/src/meet-workspace-props";
import type { MeetChannelDialogs } from "@/meet-core/src/use-meet-channel-dialogs";

export type MeetChannelActions = {
  replaceChannel: (next: MeetChannel) => void;
  /** Create or rename from the channel dialog; mock trees fall back to local writes. */
  confirmDialog: (input: MeetChannelDialogConfirmInput) => Promise<void>;
  /** Deletes the channel and, for meetings, the calendar events that point at it. */
  deleteChannel: (channelId: string) => Promise<void>;
  deleteUpcomingLeftover: (meeting: MeetUpcomingMeeting) => Promise<void>;
  patchShareWith: (channelId: string, shareWith: CollectionShareWith) => Promise<void>;
};

/** Channel writes behind the Meet workspace dialogs: create, rename, share, delete. */
export function useMeetChannelActions({
  channels,
  setChannels,
  selectedId,
  setSelectedId,
  operations,
  calendar,
  upcomingMeetings,
  dialogs,
  onError,
}: {
  channels: MeetChannel[];
  setChannels: Dispatch<SetStateAction<MeetChannel[]>>;
  selectedId: string | null;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  operations?: MeetChatOperations;
  calendar?: MeetCalendarSlice;
  upcomingMeetings: MeetUpcomingMeeting[];
  dialogs: MeetChannelDialogs;
  onError: (error: unknown) => void;
}): MeetChannelActions {
  const { setDialog, setEditMeeting, setPendingUpcomingDelete } = dialogs;

  const replaceChannel = (next: MeetChannel) => {
    setChannels((current) => current.map((row) => (row.id === next.id ? next : row)));
  };

  const confirmDialog = async (input: MeetChannelDialogConfirmInput) => {
    const dialog = dialogs.dialog;
    if (!dialog) return;
    if (dialog.mode === "create") {
      const created = operations?.createChannel
        ? await operations.createChannel(input)
        : buildMeetChannel(input);
      setChannels((current) => [...current, created]);
      setSelectedId(created.id);
      setDialog(null);
      return;
    }
    const current = channels.find((row) => row.id === dialog.channelId);
    if (!current) {
      setDialog(null);
      return;
    }
    const patched = operations?.patchChannel
      ? await operations.patchChannel(dialog.channelId, {
          name: input.name,
          groupSlug: input.groupSlug,
        })
      : applyMeetChannelPatch(current, { name: input.name, groupSlug: input.groupSlug });
    replaceChannel(patched);
    setDialog(null);
  };

  const deleteCalendarEvents = async (eventIds: string[]) => {
    if (!calendar?.deleteEvent || eventIds.length === 0) return;
    for (const eventId of eventIds) {
      try {
        await calendar.deleteEvent(eventId);
        calendar.onEventDeleted?.(eventId);
      } catch (error) {
        onError(error);
      }
    }
  };

  const deleteChannel = async (channelId: string) => {
    if (!operations?.deleteChannel) return;
    const current = channels.find((row) => row.id === channelId);
    if (!current || !canDeleteMeetChannel(current)) return;
    const origin = calendar?.workspaceOrigin ?? "";
    const matchingEventIds =
      current.kind === "meeting"
        ? [
            ...new Set([
              ...calendarEventsForMeetingChannel(
                calendar?.events ?? [],
                current,
                origin,
                channels,
              ).map((event) => event.id),
              ...upcomingEventIdsForChannel(upcomingMeetings, current, origin, channels),
            ]),
          ]
        : [];
    try {
      await operations.deleteChannel(channelId);
      const remaining = channels.filter((row) => row.id !== channelId);
      setChannels(remaining);
      if (selectedId === channelId) {
        setSelectedId(remaining[0]?.id ?? null);
      }
      setDialog(null);
      setEditMeeting(null);
      await deleteCalendarEvents(matchingEventIds);
    } catch (error) {
      onError(error);
    }
  };

  const deleteUpcomingLeftover = async (meeting: MeetUpcomingMeeting) => {
    setPendingUpcomingDelete(null);
    setEditMeeting(null);
    await deleteCalendarEvents([meeting.id]);
  };

  const patchShareWith = async (channelId: string, shareWith: CollectionShareWith) => {
    const current = channels.find((row) => row.id === channelId);
    if (!current) return;
    let patched: MeetChannel;
    try {
      patched = operations?.patchChannelShareWith
        ? await operations.patchChannelShareWith(channelId, shareWith)
        : applyMeetChannelPatch(current, {
            shareWith: mergeShareWith(current.shareWith, shareWith),
          });
    } catch (error) {
      onError(error);
      return;
    }
    replaceChannel(patched);
    setDialog((openDialog) =>
      openDialog?.mode === "edit" && openDialog.channelId === channelId
        ? { ...openDialog, shareWith: patched.shareWith }
        : openDialog,
    );
  };

  return { replaceChannel, confirmDialog, deleteChannel, deleteUpcomingLeftover, patchShareWith };
}
