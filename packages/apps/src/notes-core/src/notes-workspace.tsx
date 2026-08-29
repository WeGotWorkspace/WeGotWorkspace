import { Eye, StickyNote, Tag as TagIcon } from "lucide-react";
import type { NotesWorkspaceProps } from "@/notes-core/src/notes-workspace-props";
import "react-swipeable-list/dist/styles.css";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import {
  CollectionSidebarMark,
  CollectionSidebarRow,
} from "@/collection-sidebar/src/collection-sidebar-row";
import { TooltipProvider } from "@/ui/tooltip";
import { CollectionState } from "@/collection-state/src/collection-state";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { Tag } from "@/tag/src/tag";
import { MoveToDialog, EditDialog, DeleteDialog } from "@/dialogs/src/dialogs";
import { NoteDetailView } from "@/note-detail-view/src/note-detail-view";
import { NoteCollabSession } from "@/note-detail-view/src/note-text-editor-body";
import { MultiSelectionView } from "@/multi-selection-view/src/multi-selection-view";
import { WorkspaceApp } from "@/workspace-app/src/workspace-app";
import { WorkspaceUserFooter } from "@/workspace-shell/src/workspace-app-layout";
import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";
import { workspaceUserInitials } from "@/lib/workspace/workspace-session";
import { noteBodyToMarkdown } from "@/lib/models/note-body-markdown";
import { cn } from "@/lib/utils";
import { NotesDetailActionBar } from "@/notes-core/src/notes-detail-action-bar";
import { NotesDetailFooter } from "@/notes-core/src/notes-detail-footer";
import { formatNoteDateForList } from "@/notes-core/src/notes-date-utils";
import { NotesListPanel } from "@/notes-core/src/notes-list-panel";
import { useNotesController } from "@/notes-core/src/use-notes-controller";
import {
  noteAllowsTagAssignment,
  noteListTitle,
  noteShowsTags,
} from "@/notes-core/src/notes-note-utils";
import { noteAllowsStructureManage } from "@/notes-core/src/notes-structure-rights";
import { resolveNotesEditorEditable } from "@/notes-core/src/notes-collab-permissions";
import { DOCUMENT_TITLE_DEBOUNCE_MS, useDocumentTitle } from "@/lib/document-title";
import { useSyncRetryToast } from "@/hooks/use-sync-retry-toast";
import { useNotesFailedSync } from "@/notes-core/src/use-notes-failed-sync";
import { useNotesPendingSync } from "@/notes-core/src/use-notes-pending-sync";
import { notebookViewKey, useNotesSidebarModel } from "@/notes-core/src/use-notes-sidebar-model";
import { getNotesSyncRunner } from "@/lib/offline/notes-hybrid-operations";
import { resolveNotesOfflineUsername } from "@/lib/offline/offline-session";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { searchCollectionSharePrincipals } from "@/lib/api/wgw/calendar";
import type { NoteCollabConfig } from "@/note-detail-view/src/note-text-editor-body";
import { buildNoteCollabUrls } from "@/notes-core/src/note-collab-path";
import { createWgwNotesCollabWire } from "@/notes-core/src/notes-collab-wgw-wire";
import { notesNotebookDialogLabelsFrom } from "@/notes-core/src/notes-labels";
import { NotesNewMenu } from "@/notes-core/src/notes-new-menu";
import { notebookDotColor } from "@/notes-core/src/notes-notebook-color";
import { pendingMoveAfterNotebookCreate } from "@/notes-core/src/notes-notebook-select";
import { NotesConflictDialog } from "@/notes-core/src/notes-conflict-dialog";
import { TaskProjectDialog } from "@/tasks-core/src/task-project-dialog";
import { personalOwnerLabel } from "@/tasks-core/src/tasks-workspace-props";
import { Callout } from "@/callout/src/callout";
import { getConnectivitySnapshot, subscribeBrowserOnline } from "@/lib/offline/core/browser-online";
import "@/notes-core/src/notes-workspace.css";

export function NotesWorkspace({
  data,
  session,
  labels,
  operations,
  listLoading = false,
  bootstrapRevision = 0,
  onRefreshList,
  onLogout,
  className,
  initialView,
  initialNoteId,
  onViewChange,
  onNoteChange,
}: NotesWorkspaceProps) {
  const closeSidebarOnMobile = (closeSidebar: () => void) => {
    if (!isSidebarOverlayViewport()) return;
    closeSidebar();
  };

  const {
    L,
    notes,
    notebooks,
    sharedNotebooks,
    notebookCollections,
    tags,
    active,
    activeId,
    view,
    viewLabel,
    starred,
    archived,
    selectedIds,
    selectionMode,
    canCreateNote,
    selectedNotebook,
    selectedTag,
    canEditDelete,
    searchQuery,
    searchInputRef,
    moveDialog,
    editDialog,
    deleteDialog,
    visibleNotes,
    workspaceLayoutRef,
    isTouch,
    confirmDialog,
    isItemDragging,
    itemDragHandlers,
    sidebarDropZoneProps,
    selectionBarButtons,
    selectionBar,
    handleSelect,
    enterSelectionFor,
    selectView,
    setSearchQuery,
    setMoveDialog,
    setEditDialog,
    setDeleteDialog,
    moveToNotebook,
    assignTagToNotes,
    createNote,
    toggleStar,
    toggleArchive,
    openDeleteConfirm,
    renameNotebook,
    renameTag,
    deleteNotebook,
    deleteTag,
    toggleNoteTag,
    applyLocalBodyMarkdown,
    updateNote,
    groups,
    canManageNotebooks,
    notebookDialog,
    setNotebookDialog,
    openCreateNotebookDialog,
    openEditNotebookDialog,
    createNotebookCollection,
    updateNotebookCollection,
    patchNotebookShareWith,
    removeSharedNotebook,
    hiddenNotebookIds,
    toggleNotebookVisibility,
  } = useNotesController({
    data,
    labels,
    listLoading,
    operations,
    bootstrapRevision,
    initialView,
    initialNoteId,
    onViewChange,
    onNoteChange,
  });

  const {
    primarySidebarItems,
    ownedNotebooks,
    sharedNotebooks: sharedNotebookRows,
    tagSidebarTags,
  } = useNotesSidebarModel({
    labels: L,
    view,
    notebooks,
    sharedNotebooks,
    notebookCollections,
    tags,
    selectView,
    sidebarDropZoneProps,
    moveToNotebook,
    assignTagToNotes,
  });

  const online = useSyncExternalStore(subscribeBrowserOnline, getConnectivitySnapshot, () => true);
  const [accessLost, setAccessLost] = useState(false);
  const [reconnectConflict, setReconnectConflict] = useState(false);

  const activeNotebook = useMemo(() => {
    if (!active) return null;
    return (
      [...ownedNotebooks, ...sharedNotebookRows].find(
        (item) => item.id === active.notebookId || item.name === active.notebook,
      ) ?? null
    );
  }, [active, ownedNotebooks, sharedNotebookRows]);
  const selectNotebooks = useMemo(
    () => [...ownedNotebooks, ...sharedNotebookRows],
    [ownedNotebooks, sharedNotebookRows],
  );
  const pendingMoveAfterCreateRef = useRef<string[] | null>(null);
  const openCreateNotebook = useCallback(
    (moveNoteIds?: string[]) => {
      pendingMoveAfterCreateRef.current = moveNoteIds?.length ? moveNoteIds : null;
      openCreateNotebookDialog();
    },
    [openCreateNotebookDialog],
  );

  const noteEditable = resolveNotesEditorEditable(
    active?.myRights ??
      (activeNotebook?.myRights
        ? { mayEditContent: activeNotebook.myRights.mayWriteAll === true }
        : null),
    false,
  );
  const noteReadOnly = !noteEditable || accessLost;
  const noteCanArchive = active ? noteAllowsStructureManage(active) : true;
  const activeShowsTags = active ? noteShowsTags(active) : true;
  const activeAllowsTagAssignment = active ? noteAllowsTagAssignment(active, noteEditable) : false;

  const offlineUsername = resolveNotesOfflineUsername(session.user.username);
  const pendingNoteIds = useNotesPendingSync(offlineUsername, bootstrapRevision);
  const failedSyncCount = useNotesFailedSync(offlineUsername, bootstrapRevision);
  const [noteCollabUrls, setNoteCollabUrls] = useState<NoteCollabConfig["urls"] | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!wgwLiveApiEnabled() || !active) {
      setNoteCollabUrls(undefined);
      return;
    }
    const username = session.user.username;
    if (!username) {
      setNoteCollabUrls(undefined);
      return;
    }
    setAccessLost(false);
    let cancelled = false;
    void buildNoteCollabUrls(active.id, active.etag ?? "", {
      onPersistForbidden: () => {
        setAccessLost(true);
        setNoteCollabUrls(undefined);
      },
      onReconnectConflict: () => setReconnectConflict(true),
    })
      .then((urls) => {
        if (!cancelled) {
          setNoteCollabUrls(urls);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNoteCollabUrls(undefined);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [active]);

  // Body lives in the Docs Yjs collab document keyed by the note's virtual path;
  // only enabled against the live API (mock/Storybook uses the solo editor).
  const notesCollabWire = useMemo(() => createWgwNotesCollabWire(), []);
  const noteBodyCollab = useMemo<NoteCollabConfig | undefined>(() => {
    if (!wgwLiveApiEnabled() || !active || !noteCollabUrls) return undefined;
    const username = session.user.username;
    if (!username) return undefined;
    return {
      userName: session.user.displayName || username,
      urls: noteCollabUrls,
      wire: notesCollabWire,
    };
  }, [active, noteCollabUrls, notesCollabWire, session.user.displayName, session.user.username]);

  // Empty detail = no multi-select and no selected note. Do not use `!!active`
  // alone: cmd/ctrl-deselect and view selection-reset clear selectedIds while
  // leaving a stale activeId — list looks unselected but the action bar stayed.
  const showSingleNoteDetail = selectedIds.length === 1 && !!active && selectedIds[0] === active.id;
  const collabSessionActive = showSingleNoteDetail && noteBodyCollab != null;

  const searchSharePrincipals = useCallback(
    async (query: string) => searchCollectionSharePrincipals(query, session.user.username),
    [session.user.username],
  );

  const wrapDetailWithCollab = useCallback(
    (children: ReactNode) => {
      if (!collabSessionActive || !active || !noteBodyCollab) return children;
      return (
        <NoteCollabSession
          key={noteBodyCollab.urls.room ?? active.id}
          initialMarkdown={noteBodyToMarkdown(active.body)}
          userName={noteBodyCollab.userName}
          urls={noteBodyCollab.urls}
          wire={noteBodyCollab.wire}
          localDisplayName={noteBodyCollab.userName}
          onBodyMarkdownChange={(markdown, source) =>
            applyLocalBodyMarkdown(active.id, markdown, {
              bumpDate: source !== "hydrate",
            })
          }
        >
          {children}
        </NoteCollabSession>
      );
    },
    [active, applyLocalBodyMarkdown, collabSessionActive, noteBodyCollab],
  );

  const handleRetrySync = useCallback(() => {
    if (!offlineUsername) return;
    void getNotesSyncRunner(offlineUsername)
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

  const noteTitleActive = showSingleNoteDetail;
  const browserTitleContext = noteTitleActive && active ? noteListTitle(active) : viewLabel;
  useDocumentTitle(browserTitleContext, {
    // Body edits derive the list title; debounce tab updates while typing.
    debounceMs: noteTitleActive ? DOCUMENT_TITLE_DEBOUNCE_MS : 0,
    flushKey: activeId ?? view,
  });

  return (
    <TooltipProvider delayDuration={300}>
      <WorkspaceApp
        ref={workspaceLayoutRef}
        workspaceRoot={{
          className: cn("notes-workspace", className),
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
              <NotesNewMenu
                labels={L}
                disabled={!canCreateNote}
                onCreateNote={() => {
                  createNote();
                  closeSidebarOnMobile(c.closeSidebar);
                }}
                onCreateNotebook={canManageNotebooks ? () => openCreateNotebook() : undefined}
              />
            }
          >
            <SidebarSection items={primarySidebarItems} />
            {ownedNotebooks.length > 0 ? (
              <SidebarSection title={L.sectionNotebooks}>
                {ownedNotebooks.map((notebook) => {
                  const dropProps = sidebarDropZoneProps(`nb:${notebook.id}`, (ids) =>
                    moveToNotebook(ids, notebook.name),
                  );
                  const { isDropTarget, ...dropHandlers } = dropProps;
                  return (
                    <CollectionSidebarRow
                      key={notebook.id}
                      name={notebook.name}
                      color={notebookDotColor(notebook)}
                      selected={
                        view === notebookViewKey(notebook.id) || view === `nb:${notebook.name}`
                      }
                      visible={!hiddenNotebookIds.has(notebook.id)}
                      onToggleVisibility={() => toggleNotebookVisibility(notebook.id)}
                      onSelect={() => {
                        selectView(notebookViewKey(notebook.id));
                        closeSidebarOnMobile(c.closeSidebar);
                      }}
                      onEdit={() => openEditNotebookDialog(notebook)}
                      editLabel={L.edit}
                      rootProps={{
                        ...dropHandlers,
                        className: isDropTarget ? "collection-sidebar-row--drop-target" : undefined,
                      }}
                    />
                  );
                })}
              </SidebarSection>
            ) : null}
            {sharedNotebookRows.length > 0 ? (
              <SidebarSection title={L.sectionSharedNotebooks}>
                {sharedNotebookRows.map((notebook) => (
                  <CollectionSidebarRow
                    key={notebook.id}
                    name={notebook.name}
                    color={notebookDotColor(notebook)}
                    selected={
                      view === notebookViewKey(notebook.id) || view === `nb:${notebook.name}`
                    }
                    visible={!hiddenNotebookIds.has(notebook.id)}
                    onToggleVisibility={() => toggleNotebookVisibility(notebook.id)}
                    onSelect={() => {
                      selectView(notebookViewKey(notebook.id));
                      closeSidebarOnMobile(c.closeSidebar);
                    }}
                    onEdit={() => openEditNotebookDialog(notebook)}
                    editLabel={L.edit}
                    badges={
                      notebook.myRights?.mayWriteAll === false ? (
                        <CollectionSidebarMark label={L.viewOnly}>
                          <Eye className="size-3.5" aria-hidden />
                        </CollectionSidebarMark>
                      ) : null
                    }
                  />
                ))}
              </SidebarSection>
            ) : null}
            <SidebarSection title={L.sectionTags} className="notes-sidebar-tags">
              {tagSidebarTags.map(({ tag, selected, onSelect, isDropTarget, ...dropHandlers }) => (
                <li key={tag}>
                  <button
                    type="button"
                    className={cn(
                      "notes-sidebar-tags__item",
                      selected && "notes-sidebar-tags__item--selected",
                      isDropTarget && "notes-sidebar-tags__item--drop-target",
                    )}
                    onClick={onSelect}
                    aria-pressed={selected}
                    {...dropHandlers}
                  >
                    <Tag label={tag} icon={<TagIcon className="size-3.5" />} size="md" />
                  </button>
                </li>
              ))}
            </SidebarSection>
          </AppSidebar>
        )}
        list={(c) =>
          NotesListPanel({
            L,
            sidebarOpen: c.sidebarOpen,
            onToggleSidebar: c.toggleSidebar,
            viewLabel,
            selectedIds,
            selectionMode: selectionMode || selectedIds.length > 1,
            listLoading,
            visibleNotes,
            searchQuery,
            setSearchQuery,
            searchInputRef,
            canEditDelete,
            selectedNotebook,
            selectedTag,
            view,
            isTouch,
            starred,
            archived,
            activeId,
            isItemDragging,
            handleSelect,
            enterSelectionFor,
            itemDragHandlers,
            openEditDialog: (item) => {
              if (item.kind === "notebook") {
                const notebook = [...ownedNotebooks, ...sharedNotebookRows].find(
                  (entry) => entry.id === item.name || entry.name === item.name,
                );
                if (notebook) {
                  openEditNotebookDialog(notebook);
                  return;
                }
              }
              setEditDialog(item);
            },
            openDeleteDialog: setDeleteDialog,
            openDeleteConfirmForArchive: openDeleteConfirm,
            toggleStar,
            toggleArchive,
            selectionBar,
            onRefreshList,
            pendingNoteIds,
            notebookCollections,
          })
        }
        detailWrapper={(children) => wrapDetailWithCollab(children)}
        actionBar={(c) =>
          !showSingleNoteDetail ? null : (
            <NotesDetailActionBar
              active={active}
              labels={L}
              archived={archived}
              starred={starred}
              closeMobileDetail={c.closeMobileDetail}
              backLabel={viewLabel}
              notebooks={selectNotebooks}
              onMoveToNotebook={(notebook) => {
                if (active) moveToNotebook([active.id], notebook.name);
              }}
              onCreateNotebook={
                canManageNotebooks && active ? () => openCreateNotebook([active.id]) : undefined
              }
              toggleStar={toggleStar}
              toggleArchive={toggleArchive}
              showCollabChrome={collabSessionActive}
              notebookColor={activeNotebook?.color}
              readOnly={noteReadOnly}
              canArchive={noteCanArchive}
            />
          )
        }
        detail={() => {
          if (selectedIds.length > 1) {
            return (
              <MultiSelectionView
                count={selectedIds.length}
                label="Multiple selection"
                title={(count) => `${count} ${count === 1 ? "note" : "notes"} selected`}
                actions={selectionBarButtons}
              />
            );
          }
          if (!showSingleNoteDetail || !active) {
            return (
              <CollectionState icon={<StickyNote className="size-12" />}>
                {L.emptyDetail}
              </CollectionState>
            );
          }
          return (
            <>
              {accessLost ? (
                <Callout
                  severity="warning"
                  title={L.accessLostTitle}
                  message={L.accessLostMessage}
                />
              ) : null}
              <NoteDetailView
                noteId={active.id}
                contentRevision={formatNoteDateForList(active.date)}
                title={active.title ?? ""}
                titlePlaceholder={L.titlePlaceholder}
                onTitleChange={
                  noteReadOnly ? undefined : (title) => updateNote(active.id, { title })
                }
                tags={active.tags}
                availableTags={tags}
                showTags={activeShowsTags}
                onTagAdd={
                  activeAllowsTagAssignment ? (tag) => toggleNoteTag(active.id, tag) : undefined
                }
                onTagRemove={
                  activeAllowsTagAssignment ? (tag) => toggleNoteTag(active.id, tag) : undefined
                }
                pullQuote={active.pullQuote}
                body={active.body}
                collab={accessLost ? undefined : noteBodyCollab}
                readOnly={noteReadOnly}
              />
            </>
          );
        }}
        detailFooter={() => {
          if (!showSingleNoteDetail || !active) return null;
          return (
            <NotesDetailFooter
              lastEdited={formatNoteDateForList(active.date)}
              editedLabel={L.editedLabel}
            />
          );
        }}
      />

      <MoveToDialog
        open={!!moveDialog}
        notebooks={notebooks}
        title="Change notebook"
        description="Choose or create a notebook for the selected notes."
        confirmLabel="Change"
        allowCreate
        currentNotebook={
          moveDialog?.ids.length === 1
            ? notes.find((note) => note.id === moveDialog.ids[0])?.notebook
            : undefined
        }
        onClose={() => setMoveDialog(null)}
        onConfirm={(notebook) => {
          if (moveDialog) moveToNotebook(moveDialog.ids, notebook);
          setMoveDialog(null);
        }}
        contentClassName="notes-dialog-surface"
      />

      <EditDialog
        item={editDialog}
        onClose={() => setEditDialog(null)}
        onConfirm={(newName) => {
          if (!editDialog) return;
          if (editDialog.kind === "notebook") renameNotebook(editDialog.name, newName);
          else renameTag(editDialog.name, newName);
          setEditDialog(null);
        }}
        contentClassName="notes-dialog-surface"
      />

      <DeleteDialog
        item={deleteDialog}
        notebooks={notebooks}
        affectedCount={
          deleteDialog
            ? deleteDialog.kind === "notebook"
              ? notes.filter((note) => note.notebook === deleteDialog.name).length
              : notes.filter((note) => note.tags.includes(deleteDialog.name)).length
            : 0
        }
        onClose={() => setDeleteDialog(null)}
        onConfirm={(opts) => {
          if (!deleteDialog) return;
          if (deleteDialog.kind === "notebook") deleteNotebook(deleteDialog.name, opts);
          else deleteTag(deleteDialog.name);
          setDeleteDialog(null);
        }}
        contentClassName="notes-dialog-surface"
      />

      <TaskProjectDialog
        dialog={notebookDialog}
        groups={groups}
        personalOwnerLabel={personalOwnerLabel(session)}
        onClose={() => {
          pendingMoveAfterCreateRef.current = null;
          setNotebookDialog(null);
        }}
        onConfirm={(input) => {
          if (!notebookDialog) return;
          if (notebookDialog.mode === "create") {
            void createNotebookCollection(input).then((created) => {
              const pending = pendingMoveAfterNotebookCreate(
                created,
                pendingMoveAfterCreateRef.current,
              );
              pendingMoveAfterCreateRef.current = null;
              if (pending) moveToNotebook(pending.ids, pending.notebook);
            });
            return;
          }
          void updateNotebookCollection(notebookDialog.listId, input);
        }}
        share={
          notebookDialog?.mode === "edit" && notebookDialog.mayShare
            ? {
                online,
                onSearchPrincipals: searchSharePrincipals,
                onPatchShareWith: patchNotebookShareWith,
              }
            : undefined
        }
        onRemoveShared={
          notebookDialog?.mode === "edit" && notebookDialog.isSharee
            ? () => {
                void removeSharedNotebook(notebookDialog.listId);
              }
            : undefined
        }
        labels={notesNotebookDialogLabelsFrom(L)}
        contentClassName="notes-dialog-surface"
      />

      <NotesConflictDialog
        open={reconnectConflict}
        noteTitle={active ? noteListTitle(active) : ""}
        labels={L}
        onKeepLocal={() => setReconnectConflict(false)}
        onUseServer={() => {
          setReconnectConflict(false);
          onRefreshList?.();
        }}
      />

      {confirmDialog}
    </TooltipProvider>
  );
}
