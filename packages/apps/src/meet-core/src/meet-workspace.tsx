import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Users, Video } from "lucide-react";
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
import { MeetCallStage } from "@/meet-core/src/meet-call-stage";
import { MeetChatColumn } from "@/meet-core/src/meet-chat-column";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { ChatThreadPanel } from "@/chat-ui/src/chat-thread-panel";
import type { ChatMentionPrincipal } from "@/chat-ui/src/chat-types";
import {
  findMeetDirectMessagePerson,
  meetDirectMessagePeople,
  type MeetDirectMessagePerson,
} from "@/meet-core/src/meet-direct-messages";
import type { MeetChannel, MeetChannelKind } from "@/meet-core/src/meet-types";
import {
  meetCallLayoutToThreadLayout,
  meetThreadPlacement,
} from "@/meet-core/src/meet-thread-placement";
import { useMeetCallLayout } from "@/meet-core/src/use-meet-call-layout";
import { useMeetChatSession } from "@/meet-core/src/use-meet-chat-session";
import type { MeetWorkspaceProps } from "@/meet-core/src/meet-workspace-props";
import { SideDrawer } from "@/ui/side-drawer";
import "@/meet-core/src/meet-workspace.css";

function MeetWorkspaceThread({
  parent,
  replies,
  currentUserId,
  mentionPrincipals,
  authorPresence,
  onClose,
  onSendReply,
  onToggleReaction,
}: {
  parent: NonNullable<MeetWorkspaceProps["threadMessage"]>;
  replies: NonNullable<MeetWorkspaceProps["threadReplies"]>;
  currentUserId: string;
  mentionPrincipals: ChatMentionPrincipal[];
  authorPresence?: MeetWorkspaceProps["data"]["authorPresence"];
  onClose?: () => void;
  onSendReply?: (parentId: string, body: string) => void;
  onToggleReaction?: (messageId: string, emoji: string) => void;
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
      onClose={onClose}
      onSend={onSendReply ? (payload) => onSendReply(parent.id, payload.body) : undefined}
      onToggleReaction={onToggleReaction}
    />
  );
}

function channelDotColor(channel: MeetChannel): string {
  return channel.color?.trim() || DEFAULT_MEET_CHANNEL_COLOR;
}

function MeetDirectMessageRows({
  people,
  selectedId,
  authorPresence,
  onSelect,
}: {
  people: MeetDirectMessagePerson[];
  selectedId: string | null;
  authorPresence?: MeetWorkspaceProps["data"]["authorPresence"];
  onSelect: (channelId: string) => void;
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
            person.unreadCount ? (
              <span className="meet-workspace__unread">{person.unreadCount}</span>
            ) : undefined
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
  onEdit,
}: {
  channels: MeetChannel[];
  selectedId: string | null;
  onSelect: (channelId: string) => void;
  onEdit: (channel: MeetChannel) => void;
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
              <Video className="meet-workspace__sidebar-kind-icon" aria-hidden />
            ) : undefined
          }
          onSelect={() => onSelect(channel.id)}
          onEdit={() => onEdit(channel)}
          editLabel={channel.kind === "meeting" ? meetLabels.editMeeting : meetLabels.editChannel}
          trailing={
            channel.unreadCount ? (
              <span className="meet-workspace__unread">{channel.unreadCount}</span>
            ) : undefined
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
  callLayout,
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [channels, setChannels] = useState<MeetChannel[]>(() => data.channels ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => initialChannelId ?? data.channels?.[0]?.id ?? null,
  );
  const [dialog, setDialog] = useState<MeetChannelDialogState>(null);

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

  const selectedRef = useRef(selectedId);
  useEffect(() => {
    if (selectedRef.current === selectedId) return;
    selectedRef.current = selectedId;
    chat.closeThread();
  }, [chat.closeThread, selectedId]);

  const usingExternalStage = callStage != null;
  const resolvedCallActive = usingExternalStage ? callActive : call.callActive;
  const resolvedThreadLayout = callLayout ?? meetCallLayoutToThreadLayout(call.callLayout);
  const threadPlacement = meetThreadPlacement(resolvedThreadLayout, resolvedCallActive);

  const resolvedParent = threadMessage ?? chat.activeThread?.parent ?? null;
  const resolvedOpen = threadMessage ? threadOpen : chat.threadOpen;
  const resolvedReplies = threadMessage ? threadReplies : (chat.activeThread?.replies ?? []);
  const closeResolvedThread = onCloseThread ?? chat.closeThread;
  const openResolvedThread = onOpenThread ?? chat.openThread;
  const sendThreadReply = onSendThreadReply
    ? onSendThreadReply
    : (parentId: string, body: string) => {
        void chat.sendThreadReply({ body, mentions: [] });
        void parentId;
      };

  const builtChat = (
    <MeetChatColumn
      messages={chat.channelMessages}
      currentUserId={currentUserId}
      principals={mentionPrincipals}
      authorPresence={data.authorPresence}
      placeholder={
        selected
          ? meetChannelComposerPlaceholder(selected)
          : selectedDm
            ? meetLabels.dmComposer(selectedDm.displayName)
            : undefined
      }
      onSend={(payload) => {
        void chat.sendChannel(payload);
      }}
      onReact={(messageId, emoji) => {
        void chat.react(messageId, emoji);
      }}
      onReply={openResolvedThread}
      onDelete={(messageId) => {
        void chat.deleteMessage(messageId);
      }}
      editingMessageId={chat.editingMessageId}
      onStartEdit={chat.setEditingMessageId}
      onCancelEdit={() => chat.setEditingMessageId(null)}
      onSaveEdit={(messageId, payload) => {
        void chat.editMessage(messageId, payload);
      }}
    />
  );
  const resolvedChat = chatColumn ?? builtChat;
  const builtStage =
    callStageRoom != null ? (
      <MeetCallStage
        layout={call.callLayout}
        chat={resolvedChat}
        onLayoutChange={call.onLayoutChange}
        {...callStageRoom}
      />
    ) : null;
  const resolvedStage = callStage ?? builtStage;

  const threadContent =
    threadPanel ??
    (resolvedOpen && resolvedParent ? (
      <MeetWorkspaceThread
        parent={resolvedParent}
        replies={resolvedReplies}
        currentUserId={currentUserId}
        mentionPrincipals={mentionPrincipals}
        authorPresence={data.authorPresence}
        onClose={closeResolvedThread}
        onSendReply={sendThreadReply}
        onToggleReaction={(messageId, emoji) => {
          void chat.react(messageId, emoji);
        }}
      />
    ) : null);
  const threadVisible = Boolean(resolvedOpen && threadContent);
  const callToggle = onToggleCall ?? call.toggleCall;
  const callButtonLabel = resolvedCallActive
    ? meetLabels.leaveCall
    : selected?.kind === "meeting"
      ? meetLabels.joinCall
      : meetLabels.startCall;

  return (
    <TooltipProvider delayDuration={300}>
      <WorkspaceAppLayout
        className={cn(
          "meet-workspace meet-workspace--split",
          resolvedCallActive && resolvedStage && "meet-workspace--call-active",
          threadVisible && threadPlacement === "panel" && "meet-workspace--thread-panel",
          className,
        )}
        panel={
          threadVisible && threadPlacement === "panel" ? (
            <div
              className="workspace-app-layout__panel meet-workspace__thread-panel"
              data-open="true"
            >
              {threadContent}
            </div>
          ) : undefined
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
                  onEdit={openEdit}
                />
              </SidebarSection>
            ) : null}
            {sections.shared.length > 0 ? (
              <SidebarSection title={meetLabels.sidebarSharedWithMe}>
                <MeetSidebarRows
                  channels={sections.shared}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onEdit={openEdit}
                />
              </SidebarSection>
            ) : null}
            {sections.meetings.length > 0 ? (
              <SidebarSection title={meetLabels.sidebarMeetings}>
                <MeetSidebarRows
                  channels={sections.meetings}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onEdit={openEdit}
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
            titleSize="sm"
            titlePrefix={
              selected?.kind === "meeting" ? (
                <Video className="meet-workspace__header-kind-icon" aria-hidden />
              ) : null
            }
            subtitle={selected?.topic ?? undefined}
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
                  <IconButton
                    label={callButtonLabel}
                    icon={<Video />}
                    size="sm"
                    onClick={callToggle}
                  />
                </div>
              ) : null
            }
          />
        }
        main={
          resolvedCallActive && resolvedStage ? (
            <div className="meet-workspace__call-main">{resolvedStage}</div>
          ) : conversationOpen ? (
            <div className="meet-workspace__chat-main">{resolvedChat}</div>
          ) : (
            <div className="meet-workspace__chat-empty">{meetLabels.emptyChannelMain}</div>
          )
        }
      />
      <SideDrawer
        open={threadVisible && threadPlacement === "drawer"}
        onClose={closeResolvedThread}
        title={meetLabels.threadTitle}
        className="meet-workspace__thread-drawer"
        contentClassName="meet-workspace__thread-drawer-body"
      >
        {threadContent}
      </SideDrawer>
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
