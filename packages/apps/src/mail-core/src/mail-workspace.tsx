import { Pencil } from "lucide-react";
import "react-swipeable-list/dist/styles.css";
import { cn } from "@/lib/utils";
import type { MailComposeMode } from "@/mail-core/src/mail-compose-view";
import "@/mail-core/src/mail-workspace.css";
import { Button } from "@/button/src/button";
import { MailMoveToDialog } from "@/mail-core/src/mail-move-to-dialog";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { WorkspaceApp } from "@/workspace-app/src/workspace-app";
import { WorkspaceUserFooter } from "@/workspace-shell/src/workspace-app-layout";
import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";
import { workspaceUserInitials } from "@/lib/workspace/workspace-session";
import { MailDetailView } from "@/mail-core/src/mail-detail-view";
import { MailComposeView } from "@/mail-core/src/mail-compose-view";
import { createComposeAttachment } from "@/mail-core/src/mail-compose-utils";
import { Dialog, DialogContent } from "@/ui/dialog";
import { MultiSelectionView } from "@/multi-selection-view/src/multi-selection-view";
import { formatMailDateForDetail } from "@/mail-core/src/mail-date-utils";
import { MailDetailActionBar } from "@/mail-core/src/mail-detail-action-bar";
import { MailListPanel } from "@/mail-core/src/mail-list-panel";
import { useMailSidebarModel } from "@/mail-core/src/use-mail-sidebar-model";
import { useMailController } from "@/mail-core/src/use-mail-controller";
import { useDocumentTitle } from "@/lib/document-title";
import { folderTokenFromMailboxLabel } from "@/lib/mail/folder-token";
import type { MailWorkspaceProps } from "@/mail-core/src/mail-workspace-props";

const DEFAULT_SYSTEM_MAILBOXES = [
  "Inbox",
  "Starred",
  "Sent",
  "Drafts",
  "Spam",
  "Archive",
  "Trash",
] as const;

export function MailWorkspace({
  messages,
  mailboxes,
  session,
  labels,
  listLoading = false,
  systemMailboxes = DEFAULT_SYSTEM_MAILBOXES,
  encodeFolderToken = folderTokenFromMailboxLabel,
  mailboxLoader,
  operations,
  onLogout,
  initialActiveId,
  className,
}: MailWorkspaceProps) {
  const closeSidebarOnMobile = (closeSidebar: () => void) => {
    if (!isSidebarOverlayViewport()) return;
    closeSidebar();
  };

  const {
    L,
    allSystemMailboxes: _allSystemMailboxes,
    secondarySystemMailboxes,
    moreMailboxes,
    mail,
    active,
    activeId,
    starred,
    view,
    viewLabel,
    moveDialog,
    moveMailboxOptions,
    moveDialogCurrentMailbox,
    searchQuery,
    searchInputRef,
    listEndRef,
    workspaceLayoutRef,
    confirmDialog,
    isTouch,
    inTrash,
    isItemDragging,
    itemDragHandlers,
    sidebarDropZoneProps,
    selectedIds,
    selectionMode,
    handleSelect,
    handleMailItemDoubleClick,
    enterSelectionFor,
    setMoveDialog,
    setSearchQuery,
    effectiveListLoading,
    visibleMail,
    isLoadingMore,
    selectionBar,
    selectionBarButtons,
    mailboxView,
    selectView,
    compose,
    reply,
    replyAll,
    forward,
    openDraftInComposer,
    composeDialogId,
    requestCloseComposeDialog,
    composeDrafts,
    updateComposeDraft,
    saveComposeDraft,
    sendComposeDraft,
    requestDiscardComposeDraft,
    toggleStar,
    moveOne,
    toggleArchiveForMessage,
    toggleTrashForMessage,
    moveToMailbox,
    markRead,
    markUnread,
    sidebarUnreadBadge,
    downloadAttachment,
    consumeParentDismissSuppression,
  } = useMailController({
    messages,
    mailboxes,
    session,
    labels,
    listLoading,
    systemMailboxes,
    encodeFolderToken,
    mailboxLoader,
    operations,
    initialActiveId,
  });

  const { primarySidebarItems, systemSidebarItems, moreSidebarItems } = useMailSidebarModel({
    labels: L,
    view,
    secondarySystemMailboxes,
    moreMailboxes,
    mailboxView,
    selectView,
    sidebarUnreadBadge,
    sidebarDropZoneProps,
    moveToMailbox,
  });
  const composeTarget = composeDialogId
    ? mail.find((row) => row.id === composeDialogId)
    : undefined;
  const composeTargetDraft =
    composeDialogId && composeTarget ? composeDrafts[composeDialogId] : undefined;

  const browserTitleContext =
    active && selectedIds.length <= 1 ? active.title.trim() || L.noSubject : viewLabel;
  useDocumentTitle(browserTitleContext);

  return (
    <>
      <WorkspaceApp
        ref={workspaceLayoutRef}
        workspaceRoot={{
          className: cn("mail-workspace", className),
        }}
        sidebar={(c) => (
          <AppSidebar
            open={c.sidebarOpen}
            onCloseMobile={c.closeSidebar}
            footer={
              <WorkspaceUserFooter
                name={session.user.displayName}
                initials={workspaceUserInitials(session.user)}
                detailLine={session.user.username}
                onLogoutClick={onLogout}
              />
            }
            primaryButton={
              <Button
                label="Compose"
                icon={<Pencil />}
                onClick={() => {
                  compose();
                  closeSidebarOnMobile(c.closeSidebar);
                }}
                size="lg"
                pill
                variant="primary"
                className="w-full"
              />
            }
          >
            <SidebarSection items={primarySidebarItems} />
            <SidebarSection title={L.sectionMailboxes} items={systemSidebarItems} />
            {moreMailboxes.length > 0 ? (
              <SidebarSection title={L.sectionMore} items={moreSidebarItems} />
            ) : null}
          </AppSidebar>
        )}
        list={(c) =>
          MailListPanel({
            L,
            sidebarOpen: c.sidebarOpen,
            onToggleSidebar: c.toggleSidebar,
            viewLabel,
            selectedIds,
            selectionMode: selectionMode || selectedIds.length > 1,
            effectiveListLoading,
            visibleMail,
            searchQuery,
            setSearchQuery,
            searchInputRef,
            inTrash,
            isTouch,
            starred,
            activeId,
            isItemDragging,
            handleSelect,
            handleDoubleClick: handleMailItemDoubleClick,
            enterSelectionFor,
            itemDragHandlers,
            toggleStar,
            moveOne,
            listEndRef,
            isLoadingMore,
            selectionBar,
          })
        }
        actionBar={(c) =>
          selectedIds.length > 1 ? null : (
            <MailDetailActionBar
              active={active}
              closeMobileDetail={c.closeMobileDetail}
              backLabel={viewLabel}
              onReply={reply}
              onReplyAll={replyAll}
              onForward={forward}
              onEditDraft={() => {
                if (active) openDraftInComposer(active.id);
              }}
              setMoveDialog={setMoveDialog}
              markRead={markRead}
              markUnread={markUnread}
              toggleStar={toggleStar}
              starred={starred}
              toggleArchiveForMessage={toggleArchiveForMessage}
              toggleTrashForMessage={toggleTrashForMessage}
            />
          )
        }
        detail={() => {
          if (selectedIds.length > 1) {
            return (
              <MultiSelectionView
                count={selectedIds.length}
                label="Multiple selection"
                title={(count) => `${count} ${count === 1 ? "message" : "messages"} selected`}
                actions={selectionBarButtons}
              />
            );
          }
          return active ? (
            <MailDetailView
              mailId={active.id}
              mailbox={active.mailbox}
              date={formatMailDateForDetail(active.date)}
              title={active.title}
              emptySubjectLabel={L.noSubject}
              from={active.from}
              senderMetaLine={`${active.email}${L.detailToViewer("me")}`}
              body={active.body}
              excerpt={active.excerpt}
              bodyHtml={active.bodyHtml}
              detailLoaded={active.detailLoaded ?? false}
              attachments={active.attachments}
              onDownloadAttachment={downloadAttachment}
            />
          ) : null;
        }}
      />

      {composeTarget && composeTargetDraft ? (
        <Dialog
          open={!!composeDialogId}
          onOpenChange={(open) => {
            if (!open && consumeParentDismissSuppression()) return;
            if (!open && composeDialogId) requestCloseComposeDialog(composeDialogId);
          }}
        >
          <DialogContent
            className="mail-compose-dialog mail-compose-dialog-surface"
            onPointerDownOutside={(event) => event.preventDefault()}
            onInteractOutside={(event) => event.preventDefault()}
          >
            <MailComposeView
              editorKey={composeTarget.id}
              composeMode={composeTargetDraft.mode as MailComposeMode}
              mailbox={composeTarget.mailbox}
              to={composeTargetDraft.to}
              cc={composeTargetDraft.cc}
              bcc={composeTargetDraft.bcc}
              subject={composeTargetDraft.subject}
              body={composeTargetDraft.body}
              onToChange={(value) => updateComposeDraft(composeTarget.id, { to: value })}
              onCcChange={(value) => updateComposeDraft(composeTarget.id, { cc: value })}
              onBccChange={(value) => updateComposeDraft(composeTarget.id, { bcc: value })}
              onSubjectChange={(value) => updateComposeDraft(composeTarget.id, { subject: value })}
              onBodyChange={(value) => updateComposeDraft(composeTarget.id, { body: value })}
              onSaveDraft={() => void saveComposeDraft(composeTarget.id)}
              onSend={() => void sendComposeDraft(composeTarget.id)}
              attachments={composeTargetDraft.attachments}
              onAddAttachments={(files) =>
                updateComposeDraft(composeTarget.id, {
                  attachments: [
                    ...composeTargetDraft.attachments,
                    ...files.map((file) => createComposeAttachment(file)),
                  ],
                })
              }
              onRemoveAttachment={(attachmentId) =>
                updateComposeDraft(composeTarget.id, {
                  attachments: composeTargetDraft.attachments.filter(
                    (attachment) => attachment.id !== attachmentId,
                  ),
                })
              }
              attachFilesLabel={L.composeAttachFiles}
              attachmentsLabel={L.composeAttachmentsLabel}
              removeAttachmentLabel={L.composeRemoveAttachment}
              deleteDraftLabel={L.composeDeleteDraft}
              onDiscard={() => requestDiscardComposeDraft(composeTarget.id)}
              saving={composeTargetDraft.saving}
              sending={composeTargetDraft.sending}
            />
          </DialogContent>
        </Dialog>
      ) : null}

      <MailMoveToDialog
        open={!!moveDialog}
        labels={L}
        mailboxes={moveMailboxOptions}
        mail={mail}
        moveIds={moveDialog?.ids ?? []}
        currentMailbox={moveDialogCurrentMailbox}
        encodeFolderToken={encodeFolderToken}
        onClose={() => setMoveDialog(null)}
        onConfirm={(mailbox) => {
          if (moveDialog) moveToMailbox(moveDialog.ids, mailbox);
          setMoveDialog(null);
        }}
      />

      {confirmDialog}
    </>
  );
}
