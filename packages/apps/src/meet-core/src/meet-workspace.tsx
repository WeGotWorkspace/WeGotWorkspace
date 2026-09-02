import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Pencil, Users, Video } from "lucide-react";
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
  meetChannelTopicSubtitle,
} from "@/meet-core/src/meet-channel-label";
import { partitionMeetChannels } from "@/meet-core/src/meet-channel-partition";
import {
  applyMeetChannelPatch,
  buildMeetChannel,
  DEFAULT_MEET_CHANNEL_COLOR,
} from "@/meet-core/src/meet-channel-write";
import {
  MeetChannelDialog,
  type MeetChannelDialogConfirmInput,
  type MeetChannelDialogState,
} from "@/meet-core/src/meet-channel-dialog";
import { MeetCallBar } from "@/meet-core/src/meet-call-bar";
import { meetDeviceIdForOption } from "@/meet-core/src/meet-device-utils";
import { defaultMeetWorkspacePanelOpen } from "@/meet-core/src/meet-call-chat-panel";
import { MeetCallStage } from "@/meet-core/src/meet-call-stage";
import {
  meetCallBarVisible,
  meetCallChromeVisible,
  meetCallInviteAction,
  meetCallIsActive,
  meetCallStageShowsStage,
  meetChannelMeetingLive,
  meetSidebarRowIsLive,
  type MeetCallStageLayout,
} from "@/meet-core/src/meet-call-stage-layout";
import { meetThreadRailShowsBack } from "@/meet-core/src/meet-thread-placement";
import { meetThreadPeopleCount } from "@/meet-core/src/meet-thread-people";
import { MeetChatColumn } from "@/meet-core/src/meet-chat-column";
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
}) {
  return (
    <ChatThreadPanel
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

function MeetSidebarRowMeta({ live, unreadCount }: { live?: boolean; unreadCount?: number }) {
  if (!live && !unreadCount) return undefined;
  return (
    <span className="meet-workspace__row-meta">
      {live ? (
        <span className="meet-workspace__live" role="img" aria-label={meetLabels.liveCall}>
          <Video className="meet-workspace__live-icon" aria-hidden />
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
}: {
  people: MeetDirectMessagePerson[];
  selectedId: string | null;
  authorPresence?: MeetWorkspaceProps["data"]["authorPresence"];
  onSelect: (channelId: string) => void;
  channelHasLiveCall: (channelId: string) => boolean;
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
              unreadCount={person.unreadCount}
            />
          }
        />
      ))}
    </>
  );
}

function MeetSidebarRows({
  channels,
  selectedId,
  onSelect,
  channelHasLiveCall,
}: {
  channels: MeetChannel[];
  selectedId: string | null;
  onSelect: (channelId: string) => void;
  channelHasLiveCall: (channelId: string) => boolean;
}) {
  return (
    <>
      {channels.map((channel) => (
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
            <MeetSidebarRowMeta
              live={channelHasLiveCall(channel.id)}
              unreadCount={channel.unreadCount}
            />
          }
        />
      ))}
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
  onToggleCall,
  threadOpen = false,
  threadMessage = null,
  threadReplies = [],
  threadPanel,
  onOpenThread,
  onCloseThread,
  onSendThreadReply,
}: MeetWorkspaceProps) {
  const [sidebarOpen, setSidebarOpen] = useState(
    () =>
      !meetCallStageShowsStage(initialCallLayout ?? (callActive ? "side-by-side" : "collapsed")),
  );
  const [channels, setChannels] = useState<MeetChannel[]>(() => data.channels ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => initialChannelId ?? data.channels?.[0]?.id ?? null,
  );
  const [dialog, setDialog] = useState<MeetChannelDialogState>(null);
  const [callChatOpen, setCallChatOpen] = useState(() => {
    const startsExpanded = meetCallStageShowsStage(
      initialCallLayout ?? (callActive ? "side-by-side" : "collapsed"),
    );
    return startsExpanded || Boolean(initialThreadId) || defaultMeetWorkspacePanelOpen();
  });

  const sections = useMemo(() => partitionMeetChannels(channels), [channels]);
  const selected = channels.find((channel) => channel.id === selectedId) ?? null;
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
    });
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

  const patchShareWith = async (channelId: string, shareWith: CollectionShareWith) => {
    const current = channels.find((row) => row.id === channelId);
    if (!current) return;
    const patched = operations?.patchChannelShareWith
      ? await operations.patchChannelShareWith(channelId, shareWith)
      : applyMeetChannelPatch(current, {
          shareWith: mergeShareWith(current.shareWith, shareWith),
        });
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
  const chat = useMeetChatSession({
    initialMessages: data.messages ?? [],
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
  const closeResolvedThread = onCloseThread ?? chat.closeThread;
  const openResolvedThread = onOpenThread ?? chat.openThread;
  const sendThreadReply = useCallback(
    (parentId: string, body: string) => {
      if (onSendThreadReply) {
        onSendThreadReply(parentId, body);
        return;
      }
      void chat.sendThreadReply({ body, mentions: [] });
    },
    [chat.sendThreadReply, onSendThreadReply],
  );
  const onToggleThreadReaction = useCallback(
    (messageId: string, emoji: string) => {
      void chat.react(messageId, emoji);
    },
    [chat.react],
  );

  const onSendChannel = useCallback(
    (payload: ChatSendPayload) => {
      void chat.sendChannel(payload);
    },
    [chat.sendChannel],
  );
  const onReactChannel = useCallback(
    (messageId: string, emoji: string) => {
      void chat.react(messageId, emoji);
    },
    [chat.react],
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
      void chat.deleteMessage(messageId);
    },
    [chat.deleteMessage],
  );
  const onCancelEdit = useCallback(() => {
    chat.setEditingMessageId(null);
  }, [chat.setEditingMessageId]);
  const onSaveEdit = useCallback(
    (messageId: string, payload: ChatSendPayload) => {
      void chat.editMessage(messageId, payload);
    },
    [chat.editMessage],
  );
  const chatPlaceholder = selected
    ? meetChannelComposerPlaceholder(selected)
    : selectedDm
      ? meetLabels.dmComposer(selectedDm.displayName)
      : undefined;
  const builtChat = (
    <MeetChatColumn
      messages={chat.channelMessages}
      currentUserId={currentUserId}
      principals={mentionPrincipals}
      authorPresence={data.authorPresence}
      placeholder={chatPlaceholder}
      onSend={onSendChannel}
      onReact={onReactChannel}
      onReply={onReplyChannel}
      onDelete={onDeleteChannel}
      editingMessageId={chat.editingMessageId}
      onStartEdit={chat.setEditingMessageId}
      onCancelEdit={onCancelEdit}
      onSaveEdit={onSaveEdit}
    />
  );
  const resolvedChat = chatColumn ?? builtChat;
  const railChat = chatColumn ?? (
    <MeetChatColumn
      messages={chat.channelMessages}
      currentUserId={currentUserId}
      principals={mentionPrincipals}
      authorPresence={data.authorPresence}
      placeholder={chatPlaceholder}
      onSend={onSendChannel}
      onReact={onReactChannel}
      onReply={onReplyChannel}
      onDelete={onDeleteChannel}
      editingMessageId={chat.editingMessageId}
      onStartEdit={chat.setEditingMessageId}
      onCancelEdit={onCancelEdit}
      onSaveEdit={onSaveEdit}
    />
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
      />
    ) : null);
  const threadVisible = Boolean(resolvedOpen && threadContent);
  const callToggle = onToggleCall ?? call.toggleCall;
  const showExpandedStage = Boolean(
    resolvedStage && resolvedCallActive && meetCallStageShowsStage(resolvedStageLayout),
  );
  const channelCallActive = Boolean(selected?.callActive);
  const meetingLive = meetChannelMeetingLive({
    channelCallActive,
    localCallActive: resolvedCallActive,
  });
  const callInvite = meetCallInviteAction(meetingLive, resolvedCallActive);
  const markChannelMeetingLive = useCallback((channelId: string | null) => {
    if (!channelId) return;
    setChannels((current) =>
      current.map((row) =>
        row.id === channelId && !row.callActive ? { ...row, callActive: true } : row,
      ),
    );
  }, []);
  const onCallInvite = useCallback(() => {
    if (meetCallIsActive(resolvedStageLayout)) return;
    markChannelMeetingLive(selectedId);
    call.startCall();
  }, [call.startCall, markChannelMeetingLive, resolvedStageLayout, selectedId]);
  const showCallChrome = meetCallChromeVisible(resolvedCallActive);
  const showCallBar = conversationOpen && meetCallBarVisible(resolvedStageLayout);
  const keepCallChrome = Boolean(resolvedStage && showCallChrome);
  const callRoom = callStageRoom;
  const chatTitle = headerTitle ? meetLabels.chatInChannel(headerTitle) : meetLabels.chatTitle;
  const panelOpen = showExpandedStage ? callChatOpen : threadVisible;
  const railShowsThread = threadVisible;
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
          Boolean(channels.find((channel) => channel.id === channelId)?.callActive) ||
          Boolean(callActive && callChannelId === channelId),
        localCallActive: call.isChannelJoined(channelId),
      }),
    [call.isChannelJoined, callActive, callChannelId, channels],
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
                mainLabel={meetLabels.newChannel}
                menuLabel={meetLabels.newChannelMenu}
                onMainAction={() => openCreate("channel")}
                items={[
                  {
                    id: "create-meeting",
                    label: meetLabels.newMeeting,
                    icon: <Video aria-hidden />,
                    onClick: () => openCreate("meeting"),
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
                />
              </SidebarSection>
            ) : null}
            {sections.meetings.length > 0 ? (
              <SidebarSection title={meetLabels.sidebarMeetings}>
                <MeetSidebarRows
                  channels={sections.meetings}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  channelHasLiveCall={channelHasLiveCall}
                />
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
                <Video className="meet-workspace__header-kind-icon" aria-hidden />
              ) : null
            }
            subtitle={meetChannelTopicSubtitle(selected?.topic)}
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
                {showCallBar || keepCallChrome ? (
                  <MeetCallBar
                    elapsedLabel={callRoom?.controller.elapsedLabel ?? "0:00"}
                    selfId={callRoom?.controller.selfId ?? session.user.username ?? "self"}
                    selfName={callRoom?.displayName ?? session.user.displayName}
                    peers={callRoom?.controller.peers ?? []}
                    participantCount={callRoom?.participantCount ?? 1}
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
                    onMuteSoon={callRoom?.onMuteSoon ?? (() => {})}
                    joined={showCallChrome}
                    invite={callInvite}
                    onInvite={onCallInvite}
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
          void confirmDialog(input);
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
      />
    </TooltipProvider>
  );
}
