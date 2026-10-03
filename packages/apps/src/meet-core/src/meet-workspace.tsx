import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Mic, Pencil, Video } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { IconButton } from "@/button/src/button";
import { TooltipProvider } from "@/ui/tooltip";
import { WorkspaceAppLayout } from "@/workspace-shell/src/workspace-app-layout";
import { ViewHeader } from "@/view-header/src/view-header";
import { SidebarSegmentedNewMenu } from "@/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu";
import { cn } from "@/lib/utils";
import { useDocumentTitle } from "@/lib/document-title";
import { filterSharePrincipals, sharePrincipalsFromDirectory } from "@/share-ui/collection-share";
import type { CollectionSharePrincipal } from "@/share-ui/collection-share";
import { personalOwnerLabel } from "@/tasks-core/src/tasks-workspace-props";
import {
  meetChannelComposerPlaceholder,
  meetChannelTitle,
} from "@/meet-core/src/meet-channel-label";
import { partitionMeetChannels } from "@/meet-core/src/meet-channel-partition";
import {
  calendarEventsForMeetingChannel,
  clockLabelForMeetingChannel,
  leftoverBelongsInTodaySidebar,
  leftoverUpcomingMeetings,
  meetUpcomingAdHocRoom,
  preferredCalendarEventForMeeting,
  shouldAutoJoinScheduledMeeting,
  todaySidebarMeetingChannels,
} from "@/meet-core/src/meet-calendar-meeting";
import { useMeetNowClock } from "@/meet-core/src/use-meet-now-clock";
import { MeetCallBar } from "@/meet-core/src/meet-call-bar";
import { meetCallBarShownCount, meetCallPreviewPeers } from "@/meet-core/src/meet-call-bar-roster";
import { MeetCallKnockWaiting } from "@/meet-core/src/meet-call-knock";
import { useMeetCallStoreContext } from "@/meet-core/src/meet-call-provider";
import {
  meetCallStatusEngaged,
  meetCallUiParkedOnWorkspaceUnmount,
  meetResumeCallLayout,
  meetShouldSelectLiveCallOnBareMeet,
} from "@/meet-core/src/meet-call-resume";
import { meetDeviceIdForOption } from "@/meet-core/src/meet-device-utils";
import { defaultMeetWorkspacePanelOpen } from "@/meet-core/src/meet-call-chat-panel";
import { MeetCallStage, type MeetCallStageRoomProps } from "@/meet-core/src/meet-call-stage";
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
import { MeetChatColumn } from "@/meet-core/src/meet-chat-column";
import { mergeMeetRoomChatIntoChannel } from "@/meet-core/src/meet-chat-line";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { ChatComposer } from "@/chat-ui/src/chat-composer";
import { ChatThreadPanel } from "@/chat-ui/src/chat-thread-panel";
import type { ChatMentionPrincipal } from "@/chat-ui/src/chat-types";
import {
  findMeetDirectMessagePerson,
  meetDirectMessagePeople,
} from "@/meet-core/src/meet-direct-messages";
import type { ChatSendPayload } from "@/chat-ui/src/chat-types";
import type { ChatMessage, MeetChannel } from "@/meet-core/src/meet-types";
import {
  meetInitialCallLayoutForChannel,
  useMeetCallLayout,
} from "@/meet-core/src/use-meet-call-layout";
import { useMeetChatSession } from "@/meet-core/src/use-meet-chat-session";
import { MeetWorkspaceRail } from "@/meet-core/src/meet-workspace-rail";
import type { MeetWorkspaceProps } from "@/meet-core/src/meet-workspace-props";
import { MeetWorkspaceDialogs } from "@/meet-core/src/meet-workspace-dialogs";
import { MeetWorkspaceSidebar } from "@/meet-core/src/meet-workspace-sidebar";
import { useMeetChannelActions } from "@/meet-core/src/use-meet-channel-actions";
import { useMeetChannelDialogs } from "@/meet-core/src/use-meet-channel-dialogs";
import "@/meet-core/src/meet-workspace.css";

/** Unmatched ad-hoc visit with an active knock, join, or prepare on the stage. */
function meetVisitCallEngaged(
  unmatchedAdHocRoom: string | null | undefined,
  callStageRoom: MeetCallStageRoomProps | null | undefined,
): boolean {
  return Boolean(
    unmatchedAdHocRoom &&
    callStageRoom &&
    (callStageRoom.controller.waitingForAdmission ||
      callStageRoom.controller.inCall ||
      callStageRoom.controller.status === "preparing"),
  );
}

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
  unmatchedAdHocRoom = null,
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
  const mountedCallLayout = meetInitialCallLayoutForChannel(
    initialChannelId ?? data.channels?.[0]?.id ?? null,
    initialCallLayout ?? (callActive ? "side-by-side" : "collapsed"),
    liveCallChannelId,
  );
  const [sidebarOpen, setSidebarOpen] = useState(() => !meetCallStageShowsStage(mountedCallLayout));
  const [channels, setChannels] = useState<MeetChannel[]>(() => data.channels ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    unmatchedAdHocRoom ? null : (initialChannelId ?? data.channels?.[0]?.id ?? null),
  );
  const dialogs = useMeetChannelDialogs({ channels, calendar, operations });
  const channelActions = useMeetChannelActions({
    channels,
    setChannels,
    selectedId,
    setSelectedId,
    operations,
    calendar,
    upcomingMeetings,
    dialogs,
    onError: notifyChatError,
  });
  const [channelCaughtUp, setChannelCaughtUp] = useState(true);
  const [threadCaughtUp, setThreadCaughtUp] = useState(true);
  const [callChatOpen, setCallChatOpen] = useState(() => {
    const startsExpanded = meetCallStageShowsStage(mountedCallLayout);
    return startsExpanded || Boolean(initialThreadId) || defaultMeetWorkspacePanelOpen();
  });
  /**
   * Unmatched ad-hoc visit has no channel id, so `useMeetCallLayout` cannot
   * key expand/leave. Local chrome only — hosts with a meeting channel keep
   * the channel-keyed layout below.
   */
  const [visitCallLayout, setVisitCallLayout] = useState<MeetCallStageLayout>("compact");

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
  // Bare `/meet` (app switcher) restores the live call instead of the default channel.
  useEffect(() => {
    if (unmatchedAdHocRoom) {
      setSelectedId((current) => (current === null ? current : null));
      return;
    }
    const next =
      routeChannelId ?? meetShouldSelectLiveCallOnBareMeet({ routeChannelId, liveCallChannelId });
    if (next == null) return;
    setSelectedId((current) => (current === next ? current : next));
  }, [liveCallChannelId, routeChannelId, unmatchedAdHocRoom]);

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
  const visitMeeting = unmatchedAdHocRoom
    ? leftoverUpcoming.find((row) => meetUpcomingAdHocRoom(row.href) === unmatchedAdHocRoom)
    : undefined;
  const headerTitle = selected
    ? meetChannelTitle(selected)
    : selectedDm
      ? selectedDm.displayName
      : (visitMeeting?.title ?? meetLabels.productName);
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
  const suiteCallStore = useMeetCallStoreContext();
  const resumeCallLayout = meetResumeCallLayout(suiteCallStore?.getSnapshot().callUiLayout);
  const call = useMeetCallLayout({
    initialLayout: initialCallLayout ?? (callActive ? "side-by-side" : "collapsed"),
    operations,
    channelId: selectedId,
    liveCallChannelId,
    resumeLayout: liveCallChannelId ? resumeCallLayout : undefined,
  });
  const visitEngaged = meetVisitCallEngaged(unmatchedAdHocRoom, callStageRoom);
  /** Visit chrome without a selected channel — layout is local, not channel-keyed. */
  const visitOwnsLayout = Boolean(unmatchedAdHocRoom && !selectedId && visitEngaged);
  useEffect(() => {
    if (!visitOwnsLayout) setVisitCallLayout("compact");
  }, [visitOwnsLayout]);
  const sidebarCloseFrame = useRef<number | null>(null);
  const openExpandedChrome = useCallback(() => {
    setCallChatOpen(defaultMeetWorkspacePanelOpen());
    if (sidebarCloseFrame.current != null) {
      cancelAnimationFrame(sidebarCloseFrame.current);
    }
    sidebarCloseFrame.current = requestAnimationFrame(() => {
      sidebarCloseFrame.current = null;
      setSidebarOpen(false);
    });
  }, []);
  const leaveVisitCall = useCallback(() => {
    setVisitCallLayout("compact");
    void operations?.leaveCall?.("");
  }, [operations]);
  const handleCallLayoutChange = useCallback(
    (layout: MeetCallStageLayout) => {
      if (visitOwnsLayout) {
        if (layout === "collapsed") {
          leaveVisitCall();
          return;
        }
        setVisitCallLayout(layout);
        if (meetCallStageShowsStage(layout)) openExpandedChrome();
        return;
      }
      if (meetCallStageShowsStage(layout) && !meetCallIsActive(call.callLayout)) return;
      call.onLayoutChange(layout);
      if (!meetCallStageShowsStage(layout)) return;
      openExpandedChrome();
    },
    [call.callLayout, call.onLayoutChange, leaveVisitCall, openExpandedChrome, visitOwnsLayout],
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
  const resolvedCallActive = visitOwnsLayout
    ? Boolean(callStageRoom?.controller.inCall)
    : externalStageOnSelected
      ? callActive
      : call.callActive;
  const resolvedStageLayout = visitOwnsLayout
    ? visitCallLayout
    : externalStageOnSelected
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
      const persisted = chat.sendChannel(payload);
      void persisted.catch(notifyChatError);
      if (callStageRoom?.controller.inCall) {
        void callStageRoom.controller.sendChat(payload.body, persisted);
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
      if (meetCallStageShowsStage(resolvedStageLayout)) setCallChatOpen(true);
      openResolvedThread(message);
    },
    [openResolvedThread, resolvedStageLayout],
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
        layout={meetCallStageShowsStage(resolvedStageLayout) ? resolvedStageLayout : "fullscreen"}
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
  const visitCallToggle = visitOwnsLayout ? leaveVisitCall : callToggle;
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
  const showCallChrome =
    meetCallChromeVisible(resolvedCallActive) ||
    Boolean(visitEngaged && callStageRoom?.controller.inCall);
  const showCallBar =
    (conversationOpen && meetCallBarVisible(resolvedStageLayout, meetingLive)) || visitEngaged;
  const keepCallChrome = Boolean(resolvedStage && showCallChrome);
  const showKnockOrCallBar = showCallBar || keepCallChrome;
  const callRoom = callStageRoom;
  // Mini-player handshake: while the live call's channel is not on screen the
  // call is "parked" here, so the suite mini-player may show inside `/meet`.
  // Null store (mock/Storybook trees) makes this a no-op.
  const liveCallParked = Boolean(
    liveCallChannelId && !(selectedId === liveCallChannelId && showCallChrome),
  );
  useEffect(() => {
    suiteCallStore?.setCallUiParked(liveCallParked);
  }, [liveCallParked, suiteCallStore]);
  useEffect(() => {
    if (!suiteCallStore || !liveCallChannelId) return;
    if (selectedId !== liveCallChannelId) return;
    if (!meetCallIsActive(call.callLayout)) return;
    suiteCallStore.setCallUiLayout(call.callLayout);
  }, [call.callLayout, liveCallChannelId, selectedId, suiteCallStore]);
  useEffect(() => {
    if (!suiteCallStore || !liveCallChannelId) return;
    suiteCallStore.focusCallChannelRef.current = () => setSelectedId(liveCallChannelId);
    return () => {
      suiteCallStore.focusCallChannelRef.current = null;
    };
  }, [liveCallChannelId, suiteCallStore]);
  useEffect(
    () => () => {
      if (!suiteCallStore) return;
      const engaged = meetCallStatusEngaged(suiteCallStore.getSnapshot().status);
      suiteCallStore.setCallUiParked(meetCallUiParkedOnWorkspaceUnmount(engaged));
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
          <MeetWorkspaceSidebar
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            session={session}
            onLogout={onLogout}
            sections={sections}
            todayMeetings={todayMeetings}
            leftoverUpcoming={leftoverUpcoming}
            directMessagePeople={dmPeople}
            selectedId={selectedId}
            onSelect={setSelectedId}
            authorPresence={data.authorPresence}
            unmatchedAdHocRoom={unmatchedAdHocRoom}
            channelHasLiveCall={channelHasLiveCall}
            channelCallAudioOnly={channelCallAudioOnly}
            meetingStartLabel={meetingStartLabel}
            onCreateChannel={() => dialogs.openCreate("channel")}
            onCreateMeeting={() => dialogs.setCreateMeetingOpen(true)}
            onJoinUpcomingMeeting={onJoinUpcomingMeeting}
            onEditUpcomingMeeting={calendar ? dialogs.openEditLeftover : undefined}
          />
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
            actions={
              conversationOpen ? (
                <div className="meet-workspace__header-actions">
                  {showHeaderStart ? (
                    <SidebarSegmentedNewMenu
                      className="meet-workspace__header-start"
                      mainLabel={meetLabels.meet}
                      menuLabel={meetLabels.startCallMenu}
                      icon={<Video />}
                      size="md"
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
                      size="md"
                      variant="outline"
                      onClick={() => dialogs.openEdit(selected)}
                    />
                  ) : null}
                </div>
              ) : null
            }
          />
        }
        main={
          conversationOpen || visitEngaged ? (
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
                {showKnockOrCallBar && callRoom?.controller.waitingForAdmission ? (
                  <MeetCallKnockWaiting channelTitle={headerTitle} onCancel={visitCallToggle} />
                ) : showKnockOrCallBar ? (
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
                    onLeave={visitCallToggle}
                    onMuteParticipant={
                      callRoom?.hasSignedInIdentity
                        ? (peerId, muted) => void callRoom.controller.mutePeer(peerId, muted)
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
                {conversationOpen ? resolvedChat : null}
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
      <MeetWorkspaceDialogs
        dialogs={dialogs}
        actions={channelActions}
        session={session}
        operations={operations}
        calendar={calendar}
        groups={groups}
        personalOwnerLabel={ownerLabel}
        knownSharePrincipals={knownSharePrincipals}
        onSearchSharePrincipals={searchSharePrincipals}
        directory={data.directory}
        onSelectChannel={setSelectedId}
        onAddChannel={(created) =>
          setChannels((current) =>
            current.some((row) => row.id === created.id) ? current : [...current, created],
          )
        }
        onError={notifyChatError}
      />
    </TooltipProvider>
  );
}
