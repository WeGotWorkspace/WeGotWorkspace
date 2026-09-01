import { useCallback, useSyncExternalStore } from "react";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { MultiSelectionView } from "@/multi-selection-view/src/multi-selection-view";
import { WorkspaceApp } from "@/workspace-app/src/workspace-app";
import { WorkspaceUserFooter } from "@/workspace-shell/src/workspace-app-layout";
import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";
import { workspaceUserInitials } from "@/lib/workspace/workspace-session";
import { FileDropOverlay } from "@/file-drop-overlay/src/file-drop-overlay";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/ui/tooltip";
import { searchCollectionSharePrincipals } from "@/lib/api/wgw/calendar";
import { getConnectivitySnapshot, subscribeBrowserOnline } from "@/lib/offline/core/browser-online";
import { ContactsDetailActionBar } from "@/contacts-core/src/contacts-detail-action-bar";
import { ContactsDetailView } from "@/contacts-core/src/contacts-detail-view";
import { ContactsListPanel } from "@/contacts-core/src/contacts-list-panel";
import { ContactsNewMenu } from "@/contacts-core/src/contacts-new-menu";
import {
  ContactsAddressBookDialog,
  contactsAddressBookDialogLabelsFrom,
} from "@/contacts-core/src/contacts-addressbook-dialog";
import { contactDisplayName } from "@/contacts-core/src/contacts-display-utils";
import {
  ContactsCreateGroupDialog,
  contactsCreateGroupDialogLabelsFrom,
} from "@/contacts-core/src/contacts-create-group-dialog";
import {
  ContactsEditGroupDialog,
  contactsEditGroupDialogLabelsFrom,
} from "@/contacts-core/src/contacts-edit-group-dialog";
import { ContactsSidebarBookRows } from "@/contacts-core/src/contacts-sidebar-book-rows";
import {
  ContactsImportDialog,
  contactsImportDialogLabelsFrom,
} from "@/contacts-core/src/contacts-import-dialog";
import {
  contactsBookViewKey,
  writableGroupAddressBooks,
} from "@/contacts-core/src/contacts-addressbook-write";
import { VCF_FILE_ACCEPT } from "@/contacts-core/src/contacts-vcard-import";
import { contactDetailGroupTags } from "@/contacts-core/src/contacts-detail-groups";
import {
  canWriteContactGroup,
  contactAndGroupShareAddressBook,
  contactsGroupViewKey,
} from "@/contacts-core/src/contacts-group-utils";
import type { ContactsWorkspaceProps } from "@/contacts-core/src/contacts-workspace-props";
import { useContactsController } from "@/contacts-core/src/use-contacts-controller";
import { useContactsAddressBookMutations } from "@/contacts-core/src/use-contacts-addressbook-mutations";
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
  listLoading: incomingListLoading = false,
  listRefreshing: incomingListRefreshing = false,
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
    cards,
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
    listLoading,
    listRefreshing,
    isTouch,
    editMode,
    createMode,
    editDraft,
    displayName,
    canCreateContact,
    canImportVcf,
    canCreateGroup,
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
    addActiveGroupTag,
    removeActiveGroupTag,
    hiddenAddressBookIds,
    toggleAddressBookVisibility,
    handleSelect,
    enterSelectionFor,
    closeMobileDetail,
    selectView,
    setSearchQuery,
    createContact,
    handleImportVcf,
    importFiles,
    importDialogOpen,
    importDialogBusy,
    importDialogError,
    importDialogProgress,
    closeImportDialog,
    submitImportDialog,
    dropImportActive,
    setDropImportActive,
    fileInputRef,
    startEdit,
    cancelEdit,
    saveEdit,
    deleteActive,
    downloadActive,
    updateEditDraft,
    updatePhone,
    updateEmail,
    updatePhoneContext,
    updateEmailContext,
    updateAddress,
    updateAddressContext,
    removePhone,
    removeEmail,
    removeAddress,
    updateUrl,
    updateUrlContext,
    removeUrl,
    contactGroups,
    addressBooks,
    renameGroup,
    deleteGroup,
    openDeleteConfirm,
    removeFromGroup,
    setGroupRenameDialog,
  } = useContactsController({
    data,
    labels,
    listLoading: incomingListLoading,
    listRefreshing: incomingListRefreshing,
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

  const bookMutations = useContactsAddressBookMutations({
    labels: L,
    operations,
    addressBooks,
    view,
    selectView,
  });
  const {
    books,
    addressBookDialog,
    setAddressBookDialog,
    openEditAddressBookDialog,
    patchShareWith,
    hideSharedAddressBook,
  } = bookMutations;

  const { primarySidebarItems, ownedAddressBooks, sharedAddressBooks } = useContactsSidebarModel({
    labels: L,
    view,
    addressBooks: books,
    selectView,
  });

  const bookGroupRows = {
    groups: contactGroups,
    groupEditLabel: L.renameGroup,
    expandGroupsLabel: L.expandAddressBookGroups,
    collapseGroupsLabel: L.collapseAddressBookGroups,
    canEditGroup: (group: (typeof contactGroups)[number]) =>
      canWriteContactGroup(group, addressBooks, Boolean(operations)),
    onEditGroup: (group: (typeof contactGroups)[number]) =>
      setGroupRenameDialog({
        groupId: group.id,
        name: contactDisplayName(group),
      }),
    groupDropZoneProps: (groupId: string) => {
      const group = contactGroups.find((card) => card.id === groupId);
      return sidebarDropZoneProps(
        contactsGroupViewKey(groupId),
        (ids) => addMembersToGroup(groupId, ids),
        (ids) =>
          Boolean(group) &&
          ids.every((id) => {
            const card = cards.find((row) => row.id === id);
            return Boolean(card && contactAndGroupShareAddressBook(card, group));
          }),
      );
    },
  };

  const editingGroup = groupRenameDialog
    ? contactGroups.find((card) => card.id === groupRenameDialog.groupId)
    : undefined;
  const canDeleteEditingGroup = canWriteContactGroup(
    editingGroup,
    addressBooks,
    Boolean(operations),
  );

  const online = useSyncExternalStore(subscribeBrowserOnline, getConnectivitySnapshot, () => true);
  const searchSharePrincipals = useCallback(
    async (query: string) => searchCollectionSharePrincipals(query, session.user.username),
    [session.user.username],
  );

  const browserTitleContext = active && selectedIds.length <= 1 ? displayName : viewLabel;
  useDocumentTitle(browserTitleContext);

  return (
    <>
      <WorkspaceApp
        ref={workspaceLayoutRef}
        initialDetailOpenMobile={Boolean(initialContactId)}
        workspaceRoot={{
          className: cn("contacts-workspace", className),
        }}
        sidebar={(c) => (
          <TooltipProvider delayDuration={0}>
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
                  onCreateGroup={canCreateGroup ? () => setCreateGroupDialog(true) : undefined}
                  onImportVcf={canImportVcf ? () => fileInputRef.current?.click() : undefined}
                />
              }
            >
              <SidebarSection items={primarySidebarItems} />
              {ownedAddressBooks.length > 0 ? (
                <SidebarSection title={L.sectionAddressBooks}>
                  <ContactsSidebarBookRows
                    books={ownedAddressBooks}
                    view={view}
                    editLabel={L.editAddressBook}
                    viewOnlyLabel={L.viewOnly}
                    personalLabel={L.personalAddressBook}
                    hiddenAddressBookIds={hiddenAddressBookIds}
                    onToggleVisibility={toggleAddressBookVisibility}
                    onSelect={(bookId) => {
                      selectView(contactsBookViewKey(bookId));
                      closeSidebarOnMobile(c.closeSidebar);
                    }}
                    onEdit={openEditAddressBookDialog}
                    onSelectGroup={(groupId) => {
                      selectView(contactsGroupViewKey(groupId));
                      closeSidebarOnMobile(c.closeSidebar);
                    }}
                    {...bookGroupRows}
                  />
                </SidebarSection>
              ) : null}
              {sharedAddressBooks.length > 0 ? (
                <SidebarSection title={L.sidebarSharedWithMe}>
                  <ContactsSidebarBookRows
                    books={sharedAddressBooks}
                    view={view}
                    editLabel={L.editAddressBook}
                    viewOnlyLabel={L.viewOnly}
                    personalLabel={L.personalAddressBook}
                    hiddenAddressBookIds={hiddenAddressBookIds}
                    onToggleVisibility={toggleAddressBookVisibility}
                    onSelect={(bookId) => {
                      selectView(contactsBookViewKey(bookId));
                      closeSidebarOnMobile(c.closeSidebar);
                    }}
                    onEdit={openEditAddressBookDialog}
                    onSelectGroup={(groupId) => {
                      selectView(contactsGroupViewKey(groupId));
                      closeSidebarOnMobile(c.closeSidebar);
                    }}
                    {...bookGroupRows}
                  />
                </SidebarSection>
              ) : null}
            </AppSidebar>
          </TooltipProvider>
        )}
        list={(c) => {
          const panel = ContactsListPanel({
            L,
            sidebarOpen: c.sidebarOpen,
            onToggleSidebar: c.toggleSidebar,
            viewLabel,
            view,
            selectedGroupId: selectedGroup?.id ?? null,
            selectedIds,
            selectionMode: selectionMode || selectedIds.length > 1,
            listLoading,
            listRefreshing,
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
        actionBar={(_c) =>
          selectedIds.length > 1 ? null : (
            <ContactsDetailActionBar
              labels={L}
              canEdit={canEdit}
              editMode={editMode}
              createMode={createMode}
              canSaveCreate={canSaveCreate}
              closeMobileDetail={closeMobileDetail}
              backLabel={viewLabel}
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
          const groupTagsModel = contactDetailGroupTags({
            card: active,
            createMode,
            groups: contactGroups,
            allCards: cards,
            addressBooks,
            hasOperations: Boolean(operations),
            canCreateGroup,
          });
          return (
            <ContactsDetailView
              labels={L}
              card={active}
              createMode={createMode}
              editMode={editMode}
              editDraft={editDraft}
              displayName={displayName}
              groupTags={
                groupTagsModel.show
                  ? {
                      assigned: groupTagsModel.assigned,
                      suggestions: groupTagsModel.suggestions,
                      readonly: groupTagsModel.readonly,
                      allowCreate: groupTagsModel.allowCreate,
                      onAdd: addActiveGroupTag,
                      onRemove: removeActiveGroupTag,
                    }
                  : undefined
              }
              onDraftChange={updateEditDraft}
              onUpdatePhone={updatePhone}
              onUpdateEmail={updateEmail}
              onUpdatePhoneContext={updatePhoneContext}
              onUpdateEmailContext={updateEmailContext}
              onUpdateAddress={updateAddress}
              onUpdateAddressContext={updateAddressContext}
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
        accept={VCF_FILE_ACCEPT}
        multiple
        className="hidden"
        aria-label={L.importVcf}
        onChange={(event) => {
          void handleImportVcf(event.target.files);
          event.target.value = "";
        }}
      />

      {importFiles ? (
        <ContactsImportDialog
          open={importDialogOpen}
          files={importFiles}
          books={addressBooks}
          view={view}
          labels={contactsImportDialogLabelsFrom(L)}
          busy={importDialogBusy}
          error={importDialogError}
          progress={importDialogProgress}
          onClose={closeImportDialog}
          onImport={submitImportDialog}
        />
      ) : null}

      {confirmDialog}

      <ContactsEditGroupDialog
        open={groupRenameDialog !== null}
        name={groupRenameDialog?.name ?? ""}
        addressBookIds={editingGroup?.addressBookIds}
        books={addressBooks}
        labels={contactsEditGroupDialogLabelsFrom(L)}
        canDelete={canDeleteEditingGroup}
        onClose={() => setGroupRenameDialog(null)}
        onConfirm={(newName) => {
          if (!groupRenameDialog) return;
          renameGroup(groupRenameDialog.groupId, newName);
          setGroupRenameDialog(null);
        }}
        onDelete={
          canDeleteEditingGroup
            ? () => {
                if (!groupRenameDialog) return;
                const groupId = groupRenameDialog.groupId;
                setGroupRenameDialog(null);
                deleteGroup(groupId);
              }
            : undefined
        }
      />

      <ContactsCreateGroupDialog
        open={createGroupDialog}
        books={writableGroupAddressBooks(addressBooks)}
        view={view}
        labels={contactsCreateGroupDialogLabelsFrom(L)}
        onClose={() => setCreateGroupDialog(false)}
        onConfirm={(name, addressBookId) => {
          createGroup(name, addressBookId);
          setCreateGroupDialog(false);
        }}
      />

      <ContactsAddressBookDialog
        dialog={addressBookDialog}
        labels={contactsAddressBookDialogLabelsFrom(L)}
        onClose={() => setAddressBookDialog(null)}
        share={
          addressBookDialog?.mayShare
            ? {
                online,
                onSearchPrincipals: searchSharePrincipals,
                onPatchShareWith: patchShareWith,
              }
            : undefined
        }
        onRemoveShared={
          addressBookDialog?.isSharee
            ? () => {
                void hideSharedAddressBook(addressBookDialog.bookId);
              }
            : undefined
        }
      />
    </>
  );
}
