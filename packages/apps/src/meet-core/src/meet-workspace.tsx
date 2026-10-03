import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import { TooltipProvider } from "@/ui/tooltip";
import { WorkspaceAppLayout } from "@/workspace-shell/src/workspace-app-layout";
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
import { useMeetCallStoreContext } from "@/meet-core/src/meet-call-provider";
import {
  meetResumeCallLayout,
  meetShouldSelectLiveCallOnBareMeet,
} from "@/meet-core/src/meet-call-resume";
import { defaultMeetWorkspacePanelOpen } from "@/meet-core/src/meet-call-chat-panel";
import { MeetCallStage, type MeetCallStageRoomProps } from "@/meet-core/src/meet-call-stage";
import {
  meetCallBarVisible,
  meetCallChromeVisible,
  meetCallHeaderStartVisible,
  meetCallInviteAction,
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
import { meetLabels } from "@/meet-core/src/meet-labels";
import {
  findMeetDirectMessagePerson,
  meetDirectMessagePeople,
} from "@/meet-core/src/meet-direct-messages";
import type { MeetChannel } from "@/meet-core/src/meet-types";
import {
  meetInitialCallLayoutForChannel,
  useMeetCallLayout,
} from "@/meet-core/src/use-meet-call-layout";
import { useMeetChatColumnProps } from "@/meet-core/src/use-meet-chat-column-props";
import { useMeetChatSession } from "@/meet-core/src/use-meet-chat-session";
import { useMeetScheduledAutoJoin } from "@/meet-core/src/use-meet-scheduled-auto-join";
import { useMeetSuiteCallParking } from "@/meet-core/src/use-meet-suite-call-parking";
import { useMeetThreadSurface } from "@/meet-core/src/use-meet-thread-surface";
import { MeetWorkspaceRail } from "@/meet-core/src/meet-workspace-rail";
import type { MeetWorkspaceProps } from "@/meet-core/src/meet-workspace-props";
import { MeetWorkspaceCallBar } from "@/meet-core/src/meet-workspace-call-bar";
import { MeetWorkspaceDialogs } from "@/meet-core/src/meet-workspace-dialogs";
import { MeetWorkspaceHeader } from "@/meet-core/src/meet-workspace-header";
import { MeetWorkspaceSidebar } from "@/meet-core/src/meet-workspace-sidebar";
import {
  MeetWorkspaceMainSurfaces,
  MeetWorkspaceRailSurfaces,
} from "@/meet-core/src/meet-workspace-surfaces";
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
  const expandCallChatPanel = useCallback(() => setCallChatOpen(true), []);
  const chatPlaceholder = selected
    ? meetChannelComposerPlaceholder(selected)
    : selectedDm
      ? meetLabels.dmComposer(selectedDm.displayName)
      : undefined;
  const chatWiring = useMeetChatColumnProps({
    chat,
    selectedId,
    currentUserId,
    mentionPrincipals,
    authorPresence: data.authorPresence,
    placeholder: chatPlaceholder,
    typingByChannel,
    onComposerTyping,
    callRoom: callStageRoom,
    liveCallChannelId,
    stageLayout: resolvedStageLayout,
    onOpenThread: openResolvedThread,
    onExpandChatPanel: expandCallChatPanel,
    onSendThreadReply,
    onError: notifyChatError,
  });
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

  const threadContent = useMeetThreadSurface({
    threadPanel,
    parent: resolvedParent,
    replies: resolvedReplies,
    currentUserId,
    mentionPrincipals,
    authorPresence: data.authorPresence,
    editingMessageId: chat.editingMessageId,
    onClose: closeResolvedThread,
    onSendReply: chatWiring.sendThreadReply,
    onToggleReaction: chatWiring.onToggleThreadReaction,
    onSaveEdit: chatWiring.onSaveEdit,
    onCancelEdit: chatWiring.onCancelEdit,
    onCaughtUpChange: setThreadCaughtUp,
  });
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
  useMeetScheduledAutoJoin({
    selected,
    selectedId,
    selectedMeetingEventId: selectedMeetingEvent?.id,
    scheduledWindowLive,
    callActive: resolvedCallActive,
    liveCallChannelId,
    startCall: operations?.startCall,
    onJoin: onCallInvite,
  });
  const resolvedChat = chatColumn ?? (
    <MeetChatColumn
      key={selectedId}
      {...chatWiring.chatColumnProps}
      onCaughtUpChange={showExpandedStage ? undefined : setChannelCaughtUp}
    />
  );
  const railChat = chatColumn ?? (
    <MeetChatColumn
      key={selectedId}
      {...chatWiring.chatColumnProps}
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
  useMeetSuiteCallParking({
    suiteCallStore,
    liveCallChannelId,
    selectedId,
    showCallChrome,
    callLayout: call.callLayout,
    callLayoutIsActive: meetCallIsActive(call.callLayout),
    onFocusCallChannel: setSelectedId,
  });
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
            <MeetWorkspaceRailSurfaces
              showThread={railShowsThread}
              chat={railChat}
              thread={threadContent}
            />
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
          <MeetWorkspaceHeader
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((open) => !open)}
            title={headerTitle}
            selected={selected}
            conversationOpen={conversationOpen}
            showStart={showHeaderStart}
            onStartCall={onCallInvite}
            onEditChannel={dialogs.openEdit}
          />
        }
        main={
          <MeetWorkspaceMainSurfaces
            open={conversationOpen || visitEngaged}
            showExpandedStage={showExpandedStage}
            keepCallChrome={keepCallChrome}
            callBar={
              <MeetWorkspaceCallBar
                visible={showKnockOrCallBar}
                joined={showCallChrome}
                room={callRoom}
                channelTitle={headerTitle}
                session={session}
                previewPeerIds={selectedId ? (callParticipantsByChannel?.[selectedId] ?? []) : []}
                directory={data.directory}
                invite={callInvite}
                audioOnly={callAudioOnly}
                onExpand={() => handleCallLayoutChange("fullscreen")}
                onLeave={visitCallToggle}
                onInvite={onCallInvite}
              />
            }
            chat={conversationOpen ? resolvedChat : null}
            stage={resolvedStage}
          />
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
