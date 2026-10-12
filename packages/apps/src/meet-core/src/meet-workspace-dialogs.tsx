import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type { CollectionSharePrincipal } from "@/share-ui/collection-share";
import { MeetChannelDialog, MeetDeleteConfirmDialog } from "@/meet-core/src/meet-channel-dialog";
import { MeetCreateMeetingDialog } from "@/meet-core/src/meet-create-meeting-dialog";
import type {
  MeetChannel,
  MeetChatOperations,
  MeetDirectoryGroup,
} from "@/meet-core/src/meet-types";
import type { MeetCalendarSlice } from "@/meet-core/src/meet-workspace-props";
import type { MeetChannelActions } from "@/meet-core/src/use-meet-channel-actions";
import type { MeetChannelDialogs } from "@/meet-core/src/use-meet-channel-dialogs";

export type MeetWorkspaceDialogsProps = {
  dialogs: MeetChannelDialogs;
  actions: MeetChannelActions;
  session: WorkspaceSession;
  operations?: MeetChatOperations;
  calendar?: MeetCalendarSlice;
  groups: MeetDirectoryGroup[];
  personalOwnerLabel: string;
  knownSharePrincipals: readonly CollectionSharePrincipal[];
  onSearchSharePrincipals: (query: string) => Promise<CollectionSharePrincipal[]>;
  directory?: readonly CollectionSharePrincipal[];
  onSelectChannel: (channelId: string) => void;
  onAddChannel: (channel: MeetChannel) => void;
  onError: (error: unknown) => void;
};

/** Channel dialog, destroy confirm, and the create/edit meeting dialog for the Meet workspace. */
export function MeetWorkspaceDialogs({
  dialogs,
  actions,
  session,
  operations,
  calendar,
  groups,
  personalOwnerLabel,
  knownSharePrincipals,
  onSearchSharePrincipals,
  directory,
  onSelectChannel,
  onAddChannel,
  onError,
}: MeetWorkspaceDialogsProps) {
  const { dialog, editMeeting, pendingUpcomingDelete, pendingMeetingChannelDelete } = dialogs;
  return (
    <>
      <MeetChannelDialog
        dialog={dialog}
        groups={groups}
        personalOwnerLabel={personalOwnerLabel}
        onClose={() => dialogs.setDialog(null)}
        onConfirm={(input) => {
          void actions.confirmDialog(input).catch(onError);
        }}
        share={
          dialog?.mode === "edit" && dialog.mayShare
            ? {
                knownPrincipals: knownSharePrincipals,
                online: true,
                onSearchPrincipals: onSearchSharePrincipals,
                onPatchShareWith: actions.patchShareWith,
              }
            : undefined
        }
        onCopyGuestLink={(link) => {
          void navigator.clipboard?.writeText(link);
        }}
        onDelete={
          dialog?.mode === "edit" && dialog.mayDelete
            ? () => {
                void actions.deleteChannel(dialog.channelId);
              }
            : undefined
        }
      />
      <MeetDeleteConfirmDialog
        open={pendingUpcomingDelete !== null || pendingMeetingChannelDelete !== null}
        meetingKind
        onOpenChange={(open) => {
          if (!open) {
            dialogs.setPendingUpcomingDelete(null);
            dialogs.setPendingMeetingChannelDelete(null);
          }
        }}
        onConfirm={() => {
          if (pendingMeetingChannelDelete) {
            void actions.deleteChannel(pendingMeetingChannelDelete);
            dialogs.setPendingMeetingChannelDelete(null);
            return;
          }
          if (pendingUpcomingDelete) void actions.deleteUpcomingLeftover(pendingUpcomingDelete);
        }}
      />
      <MeetCreateMeetingDialog
        open={dialogs.createMeetingOpen || editMeeting !== null}
        mode={editMeeting ? "edit" : "create"}
        event={editMeeting?.event}
        channel={editMeeting?.channel}
        leftover={editMeeting?.leftover}
        calendars={calendar?.calendars ?? []}
        createEvent={calendar?.createEvent}
        patchEvent={calendar?.patchEvent}
        createChannel={operations?.createChannel}
        patchChannel={
          operations?.patchChannel
            ? (channelId, input) => operations.patchChannel!(channelId, input)
            : undefined
        }
        meetOperations={calendar?.meetOperations}
        sessionUsername={calendar?.sessionUsername ?? session.user.username}
        sessionDisplayName={calendar?.sessionDisplayName ?? session.user.displayName}
        sessionEmail={calendar?.sessionEmail ?? session.user.email}
        workspaceOrigin={calendar?.workspaceOrigin}
        contactCards={calendar?.contactCards}
        directory={directory}
        onClose={() => {
          dialogs.setCreateMeetingOpen(false);
          dialogs.setEditMeeting(null);
        }}
        onCreated={(event, created) => {
          calendar?.onEventCreated?.(event);
          if (created) {
            onAddChannel(created);
            onSelectChannel(created.id);
          }
          dialogs.setCreateMeetingOpen(false);
        }}
        onUpdated={(event, patched) => {
          calendar?.onEventUpdated?.(event);
          if (patched) actions.replaceChannel(patched);
          dialogs.setEditMeeting(null);
        }}
        onDelete={
          editMeeting?.channel
            ? () => {
                const channelId = editMeeting.channel!.id;
                dialogs.setEditMeeting(null);
                dialogs.setPendingMeetingChannelDelete(channelId);
              }
            : editMeeting?.leftover
              ? () => {
                  const leftover = editMeeting.leftover!;
                  dialogs.setEditMeeting(null);
                  dialogs.setPendingUpcomingDelete(leftover);
                }
              : undefined
        }
        onError={onError}
      />
    </>
  );
}
