import { EditDialog } from "@/dialogs/src/dialogs";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { MultiSelectionView } from "@/multi-selection-view/src/multi-selection-view";
import { WorkspaceApp } from "@/workspace-app/src/workspace-app";
import { WorkspaceUserFooter } from "@/workspace-shell/src/workspace-app-layout";
import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";
import { workspaceUserInitials } from "@/lib/workspace/workspace-session";
import { FileDropOverlay } from "@/file-drop-overlay/src/file-drop-overlay";
import { cn } from "@/lib/utils";
import { ContactsDetailActionBar } from "@/contacts-core/src/contacts-detail-action-bar";
import { ContactsDetailView } from "@/contacts-core/src/contacts-detail-view";
import { ContactsListPanel } from "@/contacts-core/src/contacts-list-panel";
import { ContactsNewMenu } from "@/contacts-core/src/contacts-new-menu";
import type { ContactsWorkspaceProps } from "@/contacts-core/src/contacts-workspace-props";
import { useCallback } from "react";
import { useContactsController } from "@/contacts-core/src/use-contacts-controller";
import { useDocumentTitle } from "@/lib/document-title";
import { useSyncRetryToast } from "@/hooks/use-sync-retry-toast";
import { useContactsFailedSync } from "@/contacts-core/src/use-contacts-failed-sync";
import { useContactsPendingSync } from "@/contacts-core/src/use-contacts-pending-sync";
import { useContactsSidebarModel } from "@/contacts-core/src/use-contacts-sidebar-model";
import { getContactsSyncRunner } from "@/lib/offline/contacts-hybrid-operations";
import { resolveContactsOfflineUsername } from "@/lib/offline/offline-session";
import "react-swipeable-list/dist/styles.css";
import "@/contacts-core/src/contacts-workspace.css";

export function ContactsWorkspace({
  data,
  session,
  labels,
  operations,
  listLoading = false,
  onRefreshList,
  onLogout,
  className,
  initialView,
  initialContactId,
  onViewChange,
  onContactChange,
}: ContactsWorkspaceProps) {
  const closeSidebarOnMobile = (closeSidebar: () => void) => {
    if (!isSidebarOverlayViewport()) return;
    closeSidebar();
  };

  const {
    L,
    active,
    activeId,
    view,
    viewLabel,
    visibleCards,
    selectedIds,
    selectionMode,
    searchQuery,
    searchInputRef,
    workspaceLayoutRef,
    isTouch,
    editMode,
    createMode,
    editDraft,
    displayName,
    canCreateContact,
    canImportVcf,
    canCreateGroup,
    canRenameGroup,
    canDeleteGroup,
    canEdit,
    canSaveCreate,
    confirmDialog,
    groupRenameDialog,
    createGroupDialog,
    setCreateGroupDialog,
    createGroup,
    selectedGroup,
    selectionBar,
    selectionBarButtons,
    isItemDragging,
    itemDragHandlers,
    sidebarDropZoneProps,
    addMembersToGroup,
    handleSelect,
    enterSelectionFor,
    selectView,
    setSearchQuery,
    createContact,
    handleImportVcf,
    dropImportActive,
    setDropImportActive,
    fileInputRef,
    startEdit,
    cancelEdit,
    saveEdit,
    deleteActive,
    downloadActive,
    updateEditDraft,
    addPhone,
    addEmail,
    addAddress,
    updatePhone,
    updateEmail,
    updatePhoneContext,
    updateEmailContext,
    updateAddress,
    updateAddressContext,
    removePhone,
    removeEmail,
    removeAddress,
    addUrl,
    updateUrl,
    updateUrlContext,
    removeUrl,
    contactGroups,
    renameGroup,
    openDeleteConfirm,
    openDeleteGroupConfirm,
    removeFromGroup,
    setGroupRenameDialog,
  } = useContactsController({
    data,
    labels,
    listLoading,
    operations,
    onRefreshList,
    initialView,
    initialContactId,
    onViewChange,
    onContactChange,
  });

  const offlineUsername = resolveContactsOfflineUsername(session.user.username);
  const pendingCardIds = useContactsPendingSync(offlineUsername, data.cards.length);
  const failedSyncCount = useContactsFailedSync(offlineUsername, data.cards.length);

  const handleRetrySync = useCallback(() => {
    if (!offlineUsername) return;
    void getContactsSyncRunner(offlineUsername)
      .flush()
      .finally(() => onRefreshList?.());
  }, [offlineUsername, onRefreshList]);

  useSyncRetryToast({
    active: failedSyncCount > 0,
    title: L.syncFailedTitle,
    message: L.syncFailedMessage,
    retryLabel: L.retrySync,
    onRetry: handleRetrySync,
  });

  const { primarySidebarItems, groupSidebarItems } = useContactsSidebarModel({
    labels: L,
    view,
    contactGroups,
    selectView,
    sidebarDropZoneProps,
    addMembersToGroup,
  });

  const browserTitleContext = active && selectedIds.length <= 1 ? displayName : viewLabel;
  useDocumentTitle(browserTitleContext);

  return (
    <>
      <WorkspaceApp
        ref={workspaceLayoutRef}
        workspaceRoot={{
          className: cn("contacts-workspace", className),
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
              <ContactsNewMenu
                labels={L}
                disabled={!canCreateContact}
                onCreateContact={() => {
                  createContact();
                  closeSidebarOnMobile(c.closeSidebar);
                }}
                onImportVcf={() => fileInputRef.current?.click()}
              />
            }
          >
            <SidebarSection items={primarySidebarItems} />
            {canCreateGroup || groupSidebarItems.length > 0 ? (
              <SidebarSection
                title={L.sectionGroups}
                items={groupSidebarItems}
                onAdd={canCreateGroup ? () => setCreateGroupDialog(true) : undefined}
                addLabel={L.newGroup}
              />
            ) : null}
          </AppSidebar>
        )}
        list={(c) => {
          const panel = ContactsListPanel({
            L,
            sidebarOpen: c.sidebarOpen,
            onToggleSidebar: c.toggleSidebar,
            viewLabel,
            view,
            selectedGroupId: selectedGroup?.id ?? null,
            canRenameGroup,
            openGroupRenameDialog: (groupId, name) => setGroupRenameDialog({ groupId, name }),
            canDeleteGroup,
            onDeleteGroup: openDeleteGroupConfirm,
            selectedIds,
            selectionMode: selectionMode || selectedIds.length > 1,
            listLoading,
            visibleCards,
            searchQuery,
            setSearchQuery,
            searchInputRef,
            isTouch,
            activeId,
            isItemDragging,
            handleSelect,
            enterSelectionFor,
            itemDragHandlers,
            onSwipeDelete: (id) => openDeleteConfirm([id]),
            onSwipeRemoveFromGroup: (id) => removeFromGroup([id]),
            selectionBar,
            onRefreshList,
            pendingCardIds,
          });

          return {
            ...panel,
            dropZone: canImportVcf
              ? {
                  active: dropImportActive,
                  overlay: <FileDropOverlay>{L.dropImportHint}</FileDropOverlay>,
                  onDragOver: (event) => {
                    if (!event.dataTransfer.types.includes("Files")) return;
                    event.preventDefault();
                    setDropImportActive(true);
                  },
                  onDragLeave: (event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setDropImportActive(false);
                    }
                  },
                  onDrop: (event) => {
                    if (!event.dataTransfer.types.includes("Files")) return;
                    event.preventDefault();
                    setDropImportActive(false);
                    void handleImportVcf(event.dataTransfer.files);
                  },
                }
              : undefined,
          };
        }}
        actionBar={(c) =>
          selectedIds.length > 1 ? null : (
            <ContactsDetailActionBar
              labels={L}
              canEdit={canEdit}
              editMode={editMode}
              createMode={createMode}
              canSaveCreate={canSaveCreate}
              closeMobileDetail={c.closeMobileDetail}
              onEdit={startEdit}
              onDelete={deleteActive}
              onDownload={downloadActive}
              onSave={saveEdit}
              onCancel={cancelEdit}
            />
          )
        }
        detail={() => {
          if (selectedIds.length > 1) {
            return (
              <MultiSelectionView
                count={selectedIds.length}
                label="Multiple selection"
                title={(count) => `${count} ${count === 1 ? "contact" : "contacts"} selected`}
                actions={selectionBarButtons}
              />
            );
          }
          if (!active && !createMode) return null;
          return (
            <ContactsDetailView
              labels={L}
              card={active}
              createMode={createMode}
              editMode={editMode}
              editDraft={editDraft}
              displayName={displayName}
              onDraftChange={updateEditDraft}
              onAddPhone={addPhone}
              onAddEmail={addEmail}
              onAddAddress={addAddress}
              onUpdatePhone={updatePhone}
              onUpdateEmail={updateEmail}
              onUpdatePhoneContext={updatePhoneContext}
              onUpdateEmailContext={updateEmailContext}
              onUpdateAddress={updateAddress}
              onUpdateAddressContext={updateAddressContext}
              onAddUrl={addUrl}
              onUpdateUrl={updateUrl}
              onUpdateUrlContext={updateUrlContext}
              onRemoveUrl={removeUrl}
              onRemovePhone={removePhone}
              onRemoveEmail={removeEmail}
              onRemoveAddress={removeAddress}
            />
          );
        }}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".vcf,.vcard,text/vcard,text/x-vcard,application/vcard"
        multiple
        className="hidden"
        aria-label={L.importVcf}
        onChange={(event) => {
          void handleImportVcf(event.target.files);
          event.target.value = "";
        }}
      />

      {confirmDialog}

      <EditDialog
        item={groupRenameDialog ? { kind: "group", name: groupRenameDialog.name } : null}
        onClose={() => setGroupRenameDialog(null)}
        onConfirm={(newName) => {
          if (!groupRenameDialog) return;
          renameGroup(groupRenameDialog.groupId, newName);
          setGroupRenameDialog(null);
        }}
        contentClassName="contacts-dialog-surface"
      />

      <EditDialog
        item={createGroupDialog ? { kind: "group", name: "" } : null}
        title={L.newGroup}
        onClose={() => setCreateGroupDialog(false)}
        onConfirm={(name) => {
          createGroup(name);
          setCreateGroupDialog(false);
        }}
        contentClassName="contacts-dialog-surface"
      />
    </>
  );
}
