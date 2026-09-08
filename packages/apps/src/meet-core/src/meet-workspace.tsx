import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Hash, Mic, Pencil, Users, Video } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { IconButton } from "@/button/src/button";
import { TooltipProvider } from "@/ui/tooltip";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { CollectionSidebarRow } from "@/collection-sidebar/src/collection-sidebar-row";
import { UserPresenceDot } from "@/user-avatar/src/user-avatar";
import {
  WorkspaceAppLayout,
  WorkspaceUserFooter,
} from "@/workspace-shell/src/workspace-app-layout";
import { ViewHeader } from "@/view-header/src/view-header";
import { SidebarSegmentedNewMenu } from "@/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu";
import { workspaceUserInitials } from "@/lib/workspace/workspace-session";
import { cn } from "@/lib/utils";
import { useDocumentTitle } from "@/lib/document-title";
import {
  filterSharePrincipals,
  mergeShareWith,
  sharePrincipalsFromDirectory,
} from "@/share-ui/collection-share";
import type { CollectionSharePrincipal, CollectionShareWith } from "@/share-ui/collection-share";
import { personalOwnerLabel } from "@/tasks-core/src/tasks-workspace-props";
import {
  meetChannelComposerPlaceholder,
  meetChannelHashName,
  meetChannelMemberCount,
  meetChannelTitle,
  meetMeetingHeaderSubtitle,
} from "@/meet-core/src/meet-channel-label";
import { partitionMeetChannels } from "@/meet-core/src/meet-channel-partition";
import {
  applyMeetChannelPatch,
  buildMeetChannel,
  canDeleteMeetChannel,
  DEFAULT_MEET_CHANNEL_COLOR,
} from "@/meet-core/src/meet-channel-write";
import {
  MeetChannelDialog,
  MeetDeleteConfirmDialog,
  type MeetChannelDialogConfirmInput,
  type MeetChannelDialogState,
} from "@/meet-core/src/meet-channel-dialog";
import { MeetCreateMeetingDialog } from "@/meet-core/src/meet-create-meeting-dialog";
import {
  calendarEventsForMeetingChannel,
  clockLabelForMeetingChannel,
  leftoverBelongsInTodaySidebar,
  leftoverMeetingStartLabel,
  leftoverUpcomingMeetings,
  preferredCalendarEventForMeeting,
  relativeLabelForCalendarEvent,
  shouldAutoJoinScheduledMeeting,
  todaySidebarMeetingChannels,
  upcomingEventIdsForChannel,
  type MeetUpcomingMeeting,
} from "@/meet-core/src/meet-calendar-meeting";
import { useMeetNowClock } from "@/meet-core/src/use-meet-now-clock";
import { MeetCallBar } from "@/meet-core/src/meet-call-bar";
import { meetCallBarShownCount, meetCallPreviewPeers } from "@/meet-core/src/meet-call-bar-roster";
import { MeetCallKnockWaiting } from "@/meet-core/src/meet-call-knock";
import { meetCallLiveIcon } from "@/meet-core/src/meet-call-live-icon";
import { useMeetCallStoreContext } from "@/meet-core/src/meet-call-provider";
import { meetDeviceIdForOption } from "@/meet-core/src/meet-device-utils";
import { defaultMeetWorkspacePanelOpen } from "@/meet-core/src/meet-call-chat-panel";
import { MeetCallStage } from "@/meet-core/src/meet-call-stage";
import {
  meetCallBarVisible,
  meetCallChromeVisible,
  meetCallHeaderStartVisible,
  meetCallInviteAction,
  meetCallInviteStartOptions,
  meetCallIsActive,
  meetCallLiveAudioOnly,
  meetCallStageShowsStage,
  meetChannelMeetingLive,
  meetSelectedConversationLive,
  meetSidebarRowIsLive,
  type MeetCallStageLayout,
} from "@/meet-core/src/meet-call-stage-layout";
import { meetThreadRailShowsBack } from "@/meet-core/src/meet-thread-placement";
import { meetThreadPeopleCount } from "@/meet-core/src/meet-thread-people";
import { MeetChatColumn } from "@/meet-core/src/meet-chat-column";
import { mergeMeetRoomChatIntoChannel } from "@/meet-core/src/meet-chat-line";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { ChatComposer } from "@/chat-ui/src/chat-composer";
import { chatUiLabels } from "@/chat-ui/src/chat-labels";
import { ChatThreadPanel } from "@/chat-ui/src/chat-thread-panel";
import type { ChatMentionPrincipal } from "@/chat-ui/src/chat-types";
import {
  findMeetDirectMessagePerson,
  meetDirectMessagePeople,
  type MeetDirectMessagePerson,
} from "@/meet-core/src/meet-direct-messages";
import type { ChatSendPayload } from "@/chat-ui/src/chat-types";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type { ChatMessage, MeetChannel, MeetChannelKind } from "@/meet-core/src/meet-types";
import { useMeetCallLayout } from "@/meet-core/src/use-meet-call-layout";
import { useMeetChatSession } from "@/meet-core/src/use-meet-chat-session";
import { MeetWorkspaceRail } from "@/meet-core/src/meet-workspace-rail";
import type { MeetWorkspaceProps } from "@/meet-core/src/meet-workspace-props";
import "@/meet-core/src/meet-workspace.css";

const MeetWorkspaceThread = memo(function MeetWorkspaceThread({
  parent,
  replies,
  currentUserId,
  mentionPrincipals,
  authorPresence,
  onClose,
  onSendReply,
  onToggleReaction,
  parentEditing = false,
  parentEditComposer,
  onCaughtUpChange,
}: {
  parent: NonNullable<MeetWorkspaceProps["threadMessage"]>;
  replies: NonNullable<MeetWorkspaceProps["threadReplies"]>;
  currentUserId: string;
  mentionPrincipals: ChatMentionPrincipal[];
  authorPresence?: MeetWorkspaceProps["data"]["authorPresence"];
  onClose?: () => void;
  onSendReply?: (parentId: string, body: string) => void;
  onToggleReaction?: (messageId: string, emoji: string) => void;
  parentEditing?: boolean;
  parentEditComposer?: ReactNode;
  onCaughtUpChange?: (caughtUp: boolean) => void;
}) {
  return (
    <ChatThreadPanel
      key={parent.id}
      parent={parent}
      replies={replies}
      currentUserId={currentUserId}
      title={meetLabels.threadTitle}
      closeLabel={meetLabels.threadClose}
      mentionPrincipals={mentionPrincipals}
      authorPresence={authorPresence}
      parentEditing={parentEditing}
      parentEditComposer={parentEditComposer}
      onClose={onClose}
      onSend={onSendReply ? (payload) => onSendReply(parent.id, payload.body) : undefined}
      onToggleReaction={onToggleReaction}
      onCaughtUpChange={onCaughtUpChange}
      actionsForMessage={(message) => {
        if (message.id === parent.id) return undefined;
        return [{ id: "react", onClick: () => undefined }];
      }}
    />
  );
});

function channelDotColor(channel: MeetChannel): string {
  return channel.color?.trim() || DEFAULT_MEET_CHANNEL_COLOR;
}

function MeetSidebarRowMeta({
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

function MeetDirectMessageRows({
  people,
  selectedId,
  authorPresence,
  onSelect,
  channelHasLiveCall,
  channelCallAudioOnly,
}: {
  people: MeetDirectMessagePerson[];
  selectedId: string | null;
  authorPresence?: MeetWorkspaceProps["data"]["authorPresence"];
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
            <UserPresenceDot presence={authorPresence?.[person.id] ?? "offline"} standalone />
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

function MeetUpcomingRows({
  meetings,
  onJoin,
  onEdit,
  editLabel,
}: {
  meetings: MeetUpcomingMeeting[];
  onJoin?: (href: string) => void;
  onEdit?: (meeting: MeetUpcomingMeeting) => void;
  editLabel?: string;
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

function MeetSidebarRows({
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

export function MeetWorkspace({
  data,
  session,
  operations,
  onLogout,
  className,
  initialChannelId,
  initialCallLayout,
  initialThreadId = null,
  callStageRoom,
  callActive = false,
  callChannelId,
  callLayout: _callLayout,
  callStage,
  chatColumn,
  liveCallChannelId,
  onSelectedChannelChange,
  routeChannelId,
  typingByChannel,
  onComposerTyping,
  callActiveByChannel,
  callParticipantsByChannel,
  callAudioOnlyByChannel,
  onToggleCall,
  threadOpen = false,
  threadMessage = null,
  threadReplies = [],
  threadPanel,
  onOpenThread,
  onCloseThread,
  onSendThreadReply,
  onCaughtUpChange,
  upcomingMeetings = [],
  onJoinUpcomingMeeting,
  calendar,
}: MeetWorkspaceProps) {
  const toast = useAppToast();
  const nowTick = useMeetNowClock();
  const autoJoinedMeetingRef = useRef<string | null>(null);
  // Live operations reject on auth/validation errors (mock ops never throw);
  // surface those instead of leaking unhandled rejections.
  const notifyChatError = useCallback(
    (error: unknown) => {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : meetLabels.chatActionFailed;
      toast.showError(message);
    },
    [toast],
  );
  const [sidebarOpen, setSidebarOpen] = useState(
    () =>
      !meetCallStageShowsStage(initialCallLayout ?? (callActive ? "side-by-side" : "collapsed")),
  );
  const [channels, setChannels] = useState<MeetChannel[]>(() => data.channels ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => initialChannelId ?? data.channels?.[0]?.id ?? null,
  );
  const [dialog, setDialog] = useState<MeetChannelDialogState>(null);
  const [pendingUpcomingDelete, setPendingUpcomingDelete] = useState<MeetUpcomingMeeting | null>(
    null,
  );
  const [createMeetingOpen, setCreateMeetingOpen] = useState(false);
  const [editMeeting, setEditMeeting] = useState<{
    channel?: MeetChannel;
    event?: JmapCalendarEvent | null;
    leftover?: MeetUpcomingMeeting;
  } | null>(null);
  const [pendingMeetingChannelDelete, setPendingMeetingChannelDelete] = useState<string | null>(
    null,
  );
  const [channelCaughtUp, setChannelCaughtUp] = useState(true);
  const [threadCaughtUp, setThreadCaughtUp] = useState(true);
  const [callChatOpen, setCallChatOpen] = useState(() => {
    const startsExpanded = meetCallStageShowsStage(
      initialCallLayout ?? (callActive ? "side-by-side" : "collapsed"),
    );
    return startsExpanded || Boolean(initialThreadId) || defaultMeetWorkspacePanelOpen();
  });

  // Live bootstrap patches (inbound sync) replace the seeded rows; the mock
  // path passes a stable bootstrap, so this effect is a mount-time no-op there.
  const bootstrapChannels = data.channels;
  useEffect(() => {
    setChannels((current) => bootstrapChannels ?? current);
  }, [bootstrapChannels]);

  useEffect(() => {
    onSelectedChannelChange?.(selectedId);
  }, [onSelectedChannelChange, selectedId]);

  // Follow route changes (deep link, back/forward). Selection → URL runs the
  // other way via onSelectedChannelChange, so equal values settle immediately.
  useEffect(() => {
    if (routeChannelId == null) return;
    setSelectedId((current) => (current === routeChannelId ? current : routeChannelId));
  }, [routeChannelId]);

  const sections = useMemo(() => partitionMeetChannels(channels), [channels]);
  const leftoverUpcoming = useMemo(
    () =>
      leftoverUpcomingMeetings(
        upcomingMeetings,
        channels,
        sections.meetings,
        calendar?.workspaceOrigin ?? "",
      ).filter((row) => leftoverBelongsInTodaySidebar(row, nowTick)),
    [calendar?.workspaceOrigin, channels, nowTick, sections.meetings, upcomingMeetings],
  );
  const todayMeetings = useMemo(
    () =>
      todaySidebarMeetingChannels(
        sections.meetings,
        calendar?.events ?? [],
        calendar?.workspaceOrigin ?? "",
        nowTick,
        channels,
      ),
    [calendar?.events, calendar?.workspaceOrigin, channels, nowTick, sections.meetings],
  );
  const meetingStartLabel = useCallback(
    (channel: MeetChannel) =>
      clockLabelForMeetingChannel(
        calendar?.events ?? [],
        channel,
        calendar?.workspaceOrigin ?? "",
        nowTick,
        channels,
      ),
    [calendar?.events, calendar?.workspaceOrigin, channels, nowTick],
  );
  const selected = channels.find((channel) => channel.id === selectedId) ?? null;
  const selectedMeetingEvent = useMemo(() => {
    if (!selected || selected.kind !== "meeting") return null;
    return preferredCalendarEventForMeeting(
      calendarEventsForMeetingChannel(
        calendar?.events ?? [],
        selected,
        calendar?.workspaceOrigin ?? "",
        channels,
      ),
      nowTick,
    );
  }, [calendar?.events, calendar?.workspaceOrigin, channels, nowTick, selected]);
  const scheduledWindowLive = shouldAutoJoinScheduledMeeting(selectedMeetingEvent, nowTick);
  const dmPeople = useMemo(
    () =>
      meetDirectMessagePeople(data.directory, {
        excludeId: session.user.username,
        unreadByPrincipalId: data.dmUnread,
      }),
    [data.directory, data.dmUnread, session.user.username],
  );
  const selectedDm = findMeetDirectMessagePerson(dmPeople, selectedId);
  const conversationOpen = Boolean(selected || selectedDm);
  const headerTitle = selected
    ? meetChannelTitle(selected)
    : selectedDm
      ? selectedDm.displayName
      : meetLabels.productName;
  const memberCount = selected ? meetChannelMemberCount(selected) : 0;
  const groups = useMemo(() => data.groups ?? [], [data.groups]);
  const ownerLabel = personalOwnerLabel(session);
  const knownSharePrincipals = useMemo(
    () =>
      data.directory ??
      sharePrincipalsFromDirectory({
        groups,
        excludeId: session.user.username,
      }),
    [data.directory, groups, session.user.username],
  );

  const searchSharePrincipals = useCallback(
    async (query: string): Promise<CollectionSharePrincipal[]> => {
      if (operations?.searchSharePrincipals) {
        return operations.searchSharePrincipals(query);
      }
      return filterSharePrincipals(query, knownSharePrincipals);
    },
    [knownSharePrincipals, operations],
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

  const replaceChannel = (next: MeetChannel) => {
    setChannels((current) => current.map((row) => (row.id === next.id ? next : row)));
  };

  const confirmDialog = async (input: MeetChannelDialogConfirmInput) => {
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
        notifyChatError(error);
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
      notifyChatError(error);
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
      notifyChatError(error);
      return;
    }
    replaceChannel(patched);
    setDialog((openDialog) =>
      openDialog?.mode === "edit" && openDialog.channelId === channelId
        ? { ...openDialog, shareWith: patched.shareWith }
        : openDialog,
    );
  };

  useDocumentTitle(headerTitle);

  const currentUserId = session.user.username ?? "demo.user";
  const mentionPrincipals = useMemo(
    () =>
      (data.directory ?? []).map((principal) => ({
        id: principal.id,
        displayName: principal.displayName,
      })),
    [data.directory],
  );
  const bootstrapMessages = useMemo(() => data.messages ?? [], [data.messages]);
  const chat = useMeetChatSession({
    initialMessages: bootstrapMessages,
    operations,
    selectedChannelId: selectedId,
    author: { id: currentUserId, displayName: session.user.displayName },
    directory: mentionPrincipals,
    initialThreadId,
  });
  const call = useMeetCallLayout({
    initialLayout: initialCallLayout ?? (callActive ? "side-by-side" : "collapsed"),
    operations,
    channelId: selectedId,
    liveCallChannelId,
  });
  const sidebarCloseFrame = useRef<number | null>(null);
  const handleCallLayoutChange = useCallback(
    (layout: MeetCallStageLayout) => {
      if (meetCallStageShowsStage(layout) && !meetCallIsActive(call.callLayout)) return;
      call.onLayoutChange(layout);
      if (!meetCallStageShowsStage(layout)) return;
      setCallChatOpen(defaultMeetWorkspacePanelOpen());
      if (sidebarCloseFrame.current != null) {
        cancelAnimationFrame(sidebarCloseFrame.current);
      }
      sidebarCloseFrame.current = requestAnimationFrame(() => {
        sidebarCloseFrame.current = null;
        setSidebarOpen(false);
      });
    },
    [call.callLayout, call.onLayoutChange],
  );
  useEffect(
    () => () => {
      if (sidebarCloseFrame.current != null) {
        cancelAnimationFrame(sidebarCloseFrame.current);
      }
    },
    [],
  );

  const selectedRef = useRef(selectedId);
  useEffect(() => {
    if (selectedRef.current === selectedId) return;
    selectedRef.current = selectedId;
    chat.closeThread();
    setChannelCaughtUp(true);
    setThreadCaughtUp(true);
  }, [chat.closeThread, selectedId]);

  const fixtureCallChannelId = callChannelId ?? initialChannelId ?? data.channels?.[0]?.id ?? null;
  const externalStageOnSelected =
    callStage != null && Boolean(selectedId) && selectedId === fixtureCallChannelId;
  const resolvedCallActive = externalStageOnSelected ? callActive : call.callActive;
  const resolvedStageLayout = externalStageOnSelected
    ? resolvedCallActive
      ? "side-by-side"
      : "collapsed"
    : call.callLayout;

  const resolvedParent = threadMessage ?? chat.activeThread?.parent ?? null;
  const resolvedOpen = threadMessage ? threadOpen : chat.threadOpen;
  const resolvedReplies = threadMessage ? threadReplies : (chat.activeThread?.replies ?? []);
  useEffect(() => {
    setThreadCaughtUp(true);
  }, [resolvedParent?.id]);
  const closeResolvedThread = onCloseThread ?? chat.closeThread;
  const openResolvedThread = onOpenThread ?? chat.openThread;
  const sendThreadReply = useCallback(
    (parentId: string, body: string) => {
      if (onSendThreadReply) {
        onSendThreadReply(parentId, body);
        return;
      }
      void chat.sendThreadReply({ body, mentions: [] }).catch(notifyChatError);
    },
    [chat.sendThreadReply, notifyChatError, onSendThreadReply],
  );
  const onToggleThreadReaction = useCallback(
    (messageId: string, emoji: string) => {
      void chat.react(messageId, emoji).catch(notifyChatError);
    },
    [chat.react, notifyChatError],
  );

  const onSendChannel = useCallback(
    (payload: ChatSendPayload) => {
      void chat.sendChannel(payload).catch(notifyChatError);
      if (callStageRoom?.controller.inCall) {
        void callStageRoom.controller.sendChat(payload.body);
      }
    },
    [callStageRoom, chat.sendChannel, notifyChatError],
  );
  const onReactChannel = useCallback(
    (messageId: string, emoji: string) => {
      void chat.react(messageId, emoji).catch(notifyChatError);
    },
    [chat.react, notifyChatError],
  );
  const onReplyChannel = useCallback(
    (message: ChatMessage) => {
      if (meetCallStageShowsStage(call.callLayout)) setCallChatOpen(true);
      openResolvedThread(message);
    },
    [call.callLayout, openResolvedThread],
  );
  const onDeleteChannel = useCallback(
    (messageId: string) => {
      void chat.deleteMessage(messageId).catch(notifyChatError);
    },
    [chat.deleteMessage, notifyChatError],
  );
  const onCancelEdit = useCallback(() => {
    chat.setEditingMessageId(null);
  }, [chat.setEditingMessageId]);
  const onSaveEdit = useCallback(
    (messageId: string, payload: ChatSendPayload) => {
      void chat.editMessage(messageId, payload).catch(notifyChatError);
    },
    [chat.editMessage, notifyChatError],
  );
  const chatPlaceholder = selected
    ? meetChannelComposerPlaceholder(selected)
    : selectedDm
      ? meetLabels.dmComposer(selectedDm.displayName)
      : undefined;
  const typingNames = useMemo(() => {
    if (!selectedId) return [];
    return (typingByChannel?.[selectedId] ?? [])
      .filter((userId) => userId !== currentUserId)
      .map(
        (userId) =>
          mentionPrincipals.find((principal) => principal.id === userId)?.displayName ?? userId,
      );
  }, [currentUserId, mentionPrincipals, selectedId, typingByChannel]);
  const onComposerTypingForSelected = useCallback(
    (typing: boolean) => {
      if (selectedId) onComposerTyping?.(selectedId, typing);
    },
    [onComposerTyping, selectedId],
  );
  const builtStage =
    callStageRoom != null ? (
      <MeetCallStage
        layout={meetCallStageShowsStage(call.callLayout) ? call.callLayout : "fullscreen"}
        channelTitle={headerTitle}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        chatOpen={callChatOpen}
        onToggleChat={() => setCallChatOpen((open) => !open)}
        onLayoutChange={handleCallLayoutChange}
        {...callStageRoom}
      />
    ) : null;
  const resolvedStage = externalStageOnSelected && callActive ? callStage : builtStage;

  const threadCacheRef = useRef<{
    parent: NonNullable<MeetWorkspaceProps["threadMessage"]>;
    replies: NonNullable<MeetWorkspaceProps["threadReplies"]>;
  } | null>(null);
  if (resolvedParent) {
    threadCacheRef.current = { parent: resolvedParent, replies: resolvedReplies };
  }
  const cachedThread = threadCacheRef.current;
  const parentEditing = Boolean(cachedThread && chat.editingMessageId === cachedThread.parent.id);
  const threadContent =
    threadPanel ??
    (cachedThread ? (
      <MeetWorkspaceThread
        parent={cachedThread.parent}
        replies={cachedThread.replies}
        currentUserId={currentUserId}
        mentionPrincipals={mentionPrincipals}
        authorPresence={data.authorPresence}
        onClose={closeResolvedThread}
        onSendReply={sendThreadReply}
        onToggleReaction={onToggleThreadReaction}
        parentEditing={parentEditing}
        parentEditComposer={
          parentEditing ? (
            <ChatComposer
              principals={mentionPrincipals}
              initialContent={cachedThread.parent.body}
              onSend={(payload) => onSaveEdit(cachedThread.parent.id, payload)}
              onCancel={onCancelEdit}
              hint={null}
            />
          ) : undefined
        }
        onCaughtUpChange={setThreadCaughtUp}
      />
    ) : null);
  const threadVisible = Boolean(resolvedOpen && threadContent);
  const callToggle = onToggleCall ?? call.toggleCall;
  const showExpandedStage = Boolean(
    resolvedStage && resolvedCallActive && meetCallStageShowsStage(resolvedStageLayout),
  );
  const channelCallActive = meetSelectedConversationLive(selected, selectedId, callActiveByChannel);
  const meetingLive = meetChannelMeetingLive({
    channelCallActive: channelCallActive || scheduledWindowLive,
    localCallActive: resolvedCallActive,
  });
  const callInvite = meetCallInviteAction(meetingLive, resolvedCallActive);
  const callAudioOnly = meetCallLiveAudioOnly(selectedId, callAudioOnlyByChannel);
  const showHeaderStart = conversationOpen && meetCallHeaderStartVisible(meetingLive);
  const markChannelMeetingLive = useCallback((channelId: string | null) => {
    if (!channelId) return;
    setChannels((current) =>
      current.map((row) =>
        row.id === channelId && !row.callActive ? { ...row, callActive: true } : row,
      ),
    );
  }, []);
  const onCallInvite = useCallback(
    (options?: { video?: boolean }) => {
      if (meetCallIsActive(resolvedStageLayout)) return;
      markChannelMeetingLive(selectedId);
      call.startCall(options);
    },
    [call.startCall, markChannelMeetingLive, resolvedStageLayout, selectedId],
  );
  const autoJoinSelectedIdRef = useRef(selectedId);
  useEffect(() => {
    if (autoJoinSelectedIdRef.current === selectedId) return;
    autoJoinSelectedIdRef.current = selectedId;
    autoJoinedMeetingRef.current = null;
  }, [selectedId]);
  useEffect(() => {
    if (!selected || selected.kind !== "meeting" || !selectedId) return;
    if (!scheduledWindowLive || resolvedCallActive) return;
    if (liveCallChannelId && liveCallChannelId !== selectedId) return;
    if (!operations?.startCall) return;
    const key = `${selectedId}:${selectedMeetingEvent?.id ?? "window"}`;
    if (autoJoinedMeetingRef.current === key) return;
    autoJoinedMeetingRef.current = key;
    onCallInvite();
  }, [
    liveCallChannelId,
    onCallInvite,
    operations?.startCall,
    resolvedCallActive,
    scheduledWindowLive,
    selected,
    selectedId,
    selectedMeetingEvent?.id,
  ]);
  const liveCallMessages = useMemo(
    () =>
      mergeMeetRoomChatIntoChannel(
        chat.channelMessages,
        callStageRoom?.controller.inCall ? callStageRoom.controller.chatMessages : [],
        selectedId ?? liveCallChannelId ?? "call",
      ),
    [
      callStageRoom?.controller.chatMessages,
      callStageRoom?.controller.inCall,
      chat.channelMessages,
      liveCallChannelId,
      selectedId,
    ],
  );
  const chatColumnProps = {
    messages: liveCallMessages,
    currentUserId,
    principals: mentionPrincipals,
    authorPresence: data.authorPresence,
    placeholder: chatPlaceholder,
    onSend: onSendChannel,
    onReact: onReactChannel,
    onReply: onReplyChannel,
    onDelete: onDeleteChannel,
    editingMessageId: chat.editingMessageId,
    onStartEdit: chat.setEditingMessageId,
    onCancelEdit,
    onSaveEdit,
    typingNames,
    onComposerTyping: onComposerTypingForSelected,
  };
  const builtChat = (
    <MeetChatColumn
      key={selectedId}
      {...chatColumnProps}
      onCaughtUpChange={showExpandedStage ? undefined : setChannelCaughtUp}
    />
  );
  const resolvedChat = chatColumn ?? builtChat;
  const railChat = chatColumn ?? (
    <MeetChatColumn
      key={selectedId}
      {...chatColumnProps}
      onCaughtUpChange={showExpandedStage ? setChannelCaughtUp : undefined}
    />
  );
  const showCallChrome = meetCallChromeVisible(resolvedCallActive);
  const showCallBar = conversationOpen && meetCallBarVisible(resolvedStageLayout, meetingLive);
  const keepCallChrome = Boolean(resolvedStage && showCallChrome);
  const callRoom = callStageRoom;
  // Mini-player handshake: while the live call's channel is not on screen the
  // call is "parked" here, so the suite mini-player may show inside `/meet`.
  // Null store (mock/Storybook trees) makes this a no-op.
  const suiteCallStore = useMeetCallStoreContext();
  const liveCallParked = Boolean(
    liveCallChannelId && !(selectedId === liveCallChannelId && showCallChrome),
  );
  useEffect(() => {
    suiteCallStore?.setCallUiParked(liveCallParked);
  }, [liveCallParked, suiteCallStore]);
  useEffect(() => {
    if (!suiteCallStore || !liveCallChannelId) return;
    suiteCallStore.focusCallChannelRef.current = () => setSelectedId(liveCallChannelId);
    return () => {
      suiteCallStore.focusCallChannelRef.current = null;
    };
  }, [liveCallChannelId, suiteCallStore]);
  useEffect(
    () => () => {
      suiteCallStore?.setCallUiParked(false);
    },
    [suiteCallStore],
  );
  const chatTitle = headerTitle ? meetLabels.chatInChannel(headerTitle) : meetLabels.chatTitle;
  const panelOpen = showExpandedStage ? callChatOpen : threadVisible;
  const railShowsThread = threadVisible;
  const visibleCaughtUp = railShowsThread ? threadCaughtUp : channelCaughtUp;
  useEffect(() => {
    onCaughtUpChange?.(visibleCaughtUp);
  }, [onCaughtUpChange, visibleCaughtUp]);
  const railShowsBack = meetThreadRailShowsBack(showExpandedStage, railShowsThread);
  const railTitle = railShowsThread ? meetLabels.threadTitle : chatTitle;
  const threadRoot = resolvedParent ?? cachedThread?.parent ?? null;
  const threadRepliesForPeople = resolvedParent ? resolvedReplies : (cachedThread?.replies ?? []);
  const threadPeople = railShowsThread
    ? meetThreadPeopleCount(threadRoot, threadRepliesForPeople)
    : 0;
  const canEditThreadRoot = Boolean(
    railShowsThread && threadRoot && threadRoot.authorId === currentUserId && !threadRoot.deletedAt,
  );
  const closeRail = () => {
    if (showExpandedStage) {
      setCallChatOpen(false);
      return;
    }
    if (railShowsThread) {
      closeResolvedThread();
      return;
    }
    setCallChatOpen(false);
  };
  const channelHasLiveCall = useCallback(
    (channelId: string) =>
      meetSidebarRowIsLive({
        channelCallActive:
          Boolean(callActiveByChannel?.[channelId]) ||
          Boolean(channels.find((channel) => channel.id === channelId)?.callActive) ||
          Boolean(callActive && callChannelId === channelId),
        localCallActive: call.isChannelJoined(channelId),
      }),
    [call.isChannelJoined, callActive, callActiveByChannel, callChannelId, channels],
  );
  const channelCallAudioOnly = useCallback(
    (channelId: string) => meetCallLiveAudioOnly(channelId, callAudioOnlyByChannel),
    [callAudioOnlyByChannel],
  );

  return (
    <TooltipProvider delayDuration={300}>
      <WorkspaceAppLayout
        className={cn(
          "meet-workspace meet-workspace--split",
          showExpandedStage && "meet-workspace--call-active",
          panelOpen && "meet-workspace--thread-panel",
          className,
        )}
        panel={
          <MeetWorkspaceRail
            open={panelOpen}
            title={railTitle}
            closeLabel={
              showExpandedStage || !railShowsThread ? meetLabels.chatClose : meetLabels.threadClose
            }
            onClose={closeRail}
            onBack={railShowsBack ? closeResolvedThread : undefined}
            backLabel={meetLabels.threadBack}
            headerActions={
              railShowsThread ? (
                <>
                  <span
                    className="meet-workspace__members"
                    aria-label={meetLabels.threadPeopleCount(threadPeople)}
                  >
                    <Users className="meet-workspace__members-icon" aria-hidden />
                    {threadPeople}
                  </span>
                  {canEditThreadRoot && threadRoot ? (
                    <IconButton
                      icon={<Pencil />}
                      label={chatUiLabels.edit}
                      size="sm"
                      variant="subtle"
                      active={parentEditing}
                      showTooltip={false}
                      onClick={() => chat.setEditingMessageId(threadRoot.id)}
                    />
                  ) : null}
                </>
              ) : undefined
            }
          >
            <div className="meet-workspace__rail-surfaces">
              <div
                className={cn(
                  "meet-workspace__rail-chat",
                  railShowsThread && "meet-workspace__surface--parked",
                )}
                inert={railShowsThread || undefined}
                aria-hidden={railShowsThread}
              >
                {railChat}
              </div>
              {threadContent ? (
                <div
                  className={cn(
                    "meet-workspace__rail-thread",
                    !railShowsThread && "meet-workspace__surface--parked",
                  )}
                  inert={!railShowsThread || undefined}
                  aria-hidden={!railShowsThread}
                >
                  {threadContent}
                </div>
              ) : null}
            </div>
          </MeetWorkspaceRail>
        }
        sidebar={
          <AppSidebar
            open={sidebarOpen}
            onCloseMobile={() => setSidebarOpen(false)}
            appSwitchSubtitle={meetLabels.productName}
            primaryButton={
              <SidebarSegmentedNewMenu
                mainLabel={meetLabels.newMeeting}
                menuLabel={meetLabels.newChannelMenu}
                icon={<Video />}
                onMainAction={() => setCreateMeetingOpen(true)}
                items={[
                  {
                    id: "create-channel",
                    label: meetLabels.newChannel,
                    icon: <Hash aria-hidden />,
                    onClick: () => openCreate("channel"),
                  },
                ]}
              />
            }
            footer={
              <WorkspaceUserFooter
                name={session.user.displayName}
                initials={workspaceUserInitials(session.user)}
                detailLine={session.user.username}
                onLogoutClick={onLogout}
              />
            }
          >
            {sections.channels.length > 0 ? (
              <SidebarSection title={meetLabels.sidebarChannels}>
                <MeetSidebarRows
                  channels={sections.channels}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
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
                  onSelect={setSelectedId}
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
                    onSelect={setSelectedId}
                    channelHasLiveCall={channelHasLiveCall}
                    channelCallAudioOnly={channelCallAudioOnly}
                    startLabelForChannel={meetingStartLabel}
                  />
                ) : null}
                {leftoverUpcoming.length > 0 ? (
                  <MeetUpcomingRows
                    meetings={leftoverUpcoming}
                    onJoin={onJoinUpcomingMeeting}
                    onEdit={calendar ? (meeting) => openEditLeftover(meeting) : undefined}
                    editLabel={meetLabels.editMeeting}
                  />
                ) : null}
              </SidebarSection>
            ) : null}
            {dmPeople.length > 0 ? (
              <SidebarSection title={meetLabels.sidebarDirectMessages}>
                <MeetDirectMessageRows
                  people={dmPeople}
                  selectedId={selectedId}
                  authorPresence={data.authorPresence}
                  onSelect={setSelectedId}
                  channelHasLiveCall={channelHasLiveCall}
                  channelCallAudioOnly={channelCallAudioOnly}
                />
              </SidebarSection>
            ) : null}
          </AppSidebar>
        }
        mainHeader={
          <ViewHeader
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((open) => !open)}
            title={headerTitle}
            titlePrefix={
              selected?.kind === "meeting" ? (
                <CalendarDays className="meet-workspace__header-kind-icon" aria-hidden />
              ) : null
            }
            subtitle={meetMeetingHeaderSubtitle(
              selected?.kind === "meeting"
                ? relativeLabelForCalendarEvent(selectedMeetingEvent, nowTick)
                : null,
              selected?.topic,
            )}
            actions={
              conversationOpen ? (
                <div className="meet-workspace__header-actions">
                  {selected ? (
                    <span
                      className="meet-workspace__members"
                      aria-label={meetLabels.membersCount(memberCount)}
                    >
                      <Users className="meet-workspace__members-icon" aria-hidden />
                      {memberCount}
                    </span>
                  ) : null}
                  {showHeaderStart ? (
                    <SidebarSegmentedNewMenu
                      className="meet-workspace__header-start"
                      mainLabel={meetLabels.meet}
                      menuLabel={meetLabels.startCallMenu}
                      icon={<Video />}
                      size="sm"
                      stretch={false}
                      onMainAction={() => onCallInvite()}
                      items={[
                        {
                          id: "audio-only",
                          label: meetLabels.startAudioOnly,
                          icon: <Mic aria-hidden />,
                          onClick: () => onCallInvite({ video: false }),
                        },
                      ]}
                    />
                  ) : null}
                  {selected ? (
                    <IconButton
                      className="meet-workspace__header-edit"
                      icon={<Pencil />}
                      label={
                        selected.kind === "meeting"
                          ? meetLabels.editMeeting
                          : meetLabels.editChannel
                      }
                      size="sm"
                      variant="subtle"
                      showTooltip={false}
                      onClick={() => openEdit(selected)}
                    />
                  ) : null}
                </div>
              ) : null
            }
          />
        }
        main={
          conversationOpen ? (
            <div className="meet-workspace__surfaces">
              <div
                className={cn(
                  "meet-workspace__chat-main",
                  showExpandedStage && "meet-workspace__surface--parked",
                )}
                inert={showExpandedStage || undefined}
                aria-hidden={showExpandedStage}
              >
                {/* Chunk-I knock chrome (chunk-H join policy): the compact bar
                    swaps to a knock-wait banner while this user waits to be let
                    in; joined members admit waiting guests from the action row. */}
                {(showCallBar || keepCallChrome) && callRoom?.controller.waitingForAdmission ? (
                  <MeetCallKnockWaiting channelTitle={headerTitle} onCancel={callToggle} />
                ) : showCallBar || keepCallChrome ? (
                  <MeetCallBar
                    elapsedLabel={showCallChrome ? (callRoom?.controller.elapsedLabel ?? "") : ""}
                    selfId={
                      showCallChrome
                        ? (callRoom?.controller.selfId ?? session.user.username ?? "self")
                        : (session.user.username ?? "self")
                    }
                    selfName={
                      showCallChrome
                        ? (callRoom?.displayName ?? session.user.displayName)
                        : session.user.displayName
                    }
                    selfStream={
                      showCallChrome ? (callRoom?.controller.getLocalStream() ?? null) : null
                    }
                    peers={
                      showCallChrome
                        ? (callRoom?.controller.peers ?? [])
                        : meetCallPreviewPeers(
                            selectedId ? (callParticipantsByChannel?.[selectedId] ?? []) : [],
                            data.directory,
                          )
                    }
                    participantCount={meetCallBarShownCount({
                      joined: showCallChrome,
                      participantCount: showCallChrome ? (callRoom?.participantCount ?? 0) : 0,
                      peerCount: selectedId
                        ? (callParticipantsByChannel?.[selectedId]?.length ?? 0)
                        : 0,
                    })}
                    micOn={callRoom?.controller.micOn ?? true}
                    videoOn={callRoom?.controller.videoOn ?? false}
                    cameras={callRoom?.cameras ?? []}
                    microphones={callRoom?.microphones ?? []}
                    speakers={callRoom?.speakers ?? []}
                    activeCamera={callRoom?.activeCamera ?? ""}
                    activeMic={callRoom?.activeMic ?? ""}
                    activeSpeaker={callRoom?.activeSpeaker ?? ""}
                    onToggleMic={callRoom?.controller.toggleMic ?? (() => {})}
                    onToggleVideo={callRoom?.controller.toggleVideo ?? (() => {})}
                    onCameraChange={(id) => {
                      const deviceId = meetDeviceIdForOption(callRoom?.cameras ?? [], id);
                      if (!deviceId) return;
                      void callRoom?.controller.switchCamera(deviceId);
                    }}
                    onMicrophoneChange={(id) => {
                      const deviceId = meetDeviceIdForOption(callRoom?.microphones ?? [], id);
                      if (!deviceId) return;
                      void callRoom?.controller.switchMic(deviceId);
                    }}
                    onSpeakerChange={callRoom?.onSpeakerChange ?? (() => {})}
                    onExpand={() => handleCallLayoutChange("fullscreen")}
                    onLeave={callToggle}
                    onMuteParticipant={
                      callRoom?.hasSignedInIdentity
                        ? (peerId) => void callRoom.controller.mutePeer(peerId)
                        : undefined
                    }
                    joined={showCallChrome}
                    invite={callInvite}
                    audioOnly={callAudioOnly}
                    onInvite={() => onCallInvite(meetCallInviteStartOptions(callAudioOnly))}
                    knockers={
                      showCallChrome && callRoom?.hasSignedInIdentity
                        ? callRoom.controller.knockers
                        : []
                    }
                    onAdmitKnocker={
                      showCallChrome && callRoom
                        ? (peerId) => void callRoom.controller.admitKnocker(peerId)
                        : undefined
                    }
                    onDenyKnocker={
                      showCallChrome && callRoom
                        ? (peerId) => void callRoom.controller.denyKnocker(peerId)
                        : undefined
                    }
                  />
                ) : null}
                {resolvedChat}
              </div>
              {keepCallChrome ? (
                <div
                  className={cn(
                    "meet-workspace__call-main",
                    !showExpandedStage && "meet-workspace__surface--parked",
                  )}
                  inert={!showExpandedStage || undefined}
                  aria-hidden={!showExpandedStage}
                >
                  {resolvedStage}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="meet-workspace__chat-empty">{meetLabels.emptyChannelMain}</div>
          )
        }
      />
      <MeetChannelDialog
        dialog={dialog}
        groups={groups}
        personalOwnerLabel={ownerLabel}
        onClose={() => setDialog(null)}
        onConfirm={(input) => {
          void confirmDialog(input).catch(notifyChatError);
        }}
        share={
          dialog?.mode === "edit" && dialog.mayShare
            ? {
                knownPrincipals: knownSharePrincipals,
                online: true,
                onSearchPrincipals: searchSharePrincipals,
                onPatchShareWith: patchShareWith,
              }
            : undefined
        }
        onCopyGuestLink={(link) => {
          void navigator.clipboard?.writeText(link);
        }}
        onDelete={
          dialog?.mode === "edit" && dialog.mayDelete
            ? () => {
                void deleteChannel(dialog.channelId);
              }
            : undefined
        }
      />
      <MeetDeleteConfirmDialog
        open={pendingUpcomingDelete !== null || pendingMeetingChannelDelete !== null}
        meetingKind
        onOpenChange={(open) => {
          if (!open) {
            setPendingUpcomingDelete(null);
            setPendingMeetingChannelDelete(null);
          }
        }}
        onConfirm={() => {
          if (pendingMeetingChannelDelete) {
            void deleteChannel(pendingMeetingChannelDelete);
            setPendingMeetingChannelDelete(null);
            return;
          }
          if (pendingUpcomingDelete) void deleteUpcomingLeftover(pendingUpcomingDelete);
        }}
      />
      <MeetCreateMeetingDialog
        open={createMeetingOpen || editMeeting !== null}
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
        directory={data.directory}
        onClose={() => {
          setCreateMeetingOpen(false);
          setEditMeeting(null);
        }}
        onCreated={(event, created) => {
          calendar?.onEventCreated?.(event);
          if (created) {
            setChannels((current) =>
              current.some((row) => row.id === created.id) ? current : [...current, created],
            );
            setSelectedId(created.id);
          }
          setCreateMeetingOpen(false);
        }}
        onUpdated={(event, patched) => {
          calendar?.onEventUpdated?.(event);
          if (patched) replaceChannel(patched);
          setEditMeeting(null);
        }}
        onDelete={
          editMeeting?.channel
            ? () => {
                const channelId = editMeeting.channel!.id;
                setEditMeeting(null);
                setPendingMeetingChannelDelete(channelId);
              }
            : editMeeting?.leftover
              ? () => {
                  const leftover = editMeeting.leftover!;
                  setEditMeeting(null);
                  setPendingUpcomingDelete(leftover);
                }
              : undefined
        }
        onError={notifyChatError}
      />
    </TooltipProvider>
  );
}
