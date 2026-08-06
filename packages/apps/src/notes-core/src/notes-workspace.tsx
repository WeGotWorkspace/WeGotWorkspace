import { Pencil } from "lucide-react";
import type { NotesWorkspaceProps } from "@/notes-core/src/notes-workspace-props";
import "react-swipeable-list/dist/styles.css";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/button/src/button";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { MoveToDialog, EditDialog, DeleteDialog, TagPickerDialog } from "@/dialogs/src/dialogs";
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
import { noteListTitle } from "@/notes-core/src/notes-note-utils";
import { useDocumentTitle } from "@/lib/document-title";
import { useSyncRetryToast } from "@/hooks/use-sync-retry-toast";
import { useNotesFailedSync } from "@/notes-core/src/use-notes-failed-sync";
import { useNotesPendingSync } from "@/notes-core/src/use-notes-pending-sync";
import { useNotesSidebarModel } from "@/notes-core/src/use-notes-sidebar-model";
import { getNotesSyncRunner } from "@/lib/offline/notes-hybrid-operations";
import { resolveNotesOfflineUsername } from "@/lib/offline/offline-session";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import type { NoteCollabConfig } from "@/note-detail-view/src/note-text-editor-body";
import { buildNoteCollabUrls, noteCollabPath } from "@/notes-core/src/note-collab-path";
import { createWgwNotesCollabWire } from "@/notes-core/src/notes-collab-wgw-wire";
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
    tagDialog,
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
    setTagDialog,
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

  const { primarySidebarItems, notebookSidebarItems, tagSidebarItems } = useNotesSidebarModel({
    labels: L,
    view,
    notebooks,
    tags,
    selectView,
    sidebarDropZoneProps,
    moveToNotebook,
    assignTagToNotes,
  });

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
    const path = noteCollabPath({
      scope: { kind: "personal", username },
      notebook: active.notebook,
      noteId: active.id,
      archived: !!archived[active.id],
    });
    let cancelled = false;
    void buildNoteCollabUrls(path)
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
  }, [active, archived, session.user.username]);

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

  const showSingleNoteDetail = selectedIds.length <= 1 && !!active;
  const collabSessionActive = showSingleNoteDetail && noteBodyCollab != null;

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
        >
          {children}
        </NoteCollabSession>
      );
    },
    [active, collabSessionActive, noteBodyCollab],
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

  const browserTitleContext = active && selectedIds.length <= 1 ? noteListTitle(active) : viewLabel;
  useDocumentTitle(browserTitleContext);

  return (
    <>
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
              <Button
                label={L.newNote}
                icon={<Pencil />}
                onClick={() => {
                  createNote();
                  closeSidebarOnMobile(c.closeSidebar);
                }}
                size="lg"
                pill
                variant="primary"
                disabled={!canCreateNote}
                className="w-full"
              />
            }
          >
            <SidebarSection items={primarySidebarItems} />
            <SidebarSection title={L.sectionNotebooks} items={notebookSidebarItems} />
            <SidebarSection title={L.sectionTags} items={tagSidebarItems} />
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
            openEditDialog: setEditDialog,
            openDeleteDialog: setDeleteDialog,
            openDeleteConfirmForArchive: openDeleteConfirm,
            toggleStar,
            toggleArchive,
            selectionBar,
            onRefreshList,
            pendingNoteIds,
          })
        }
        detailWrapper={(children) => wrapDetailWithCollab(children)}
        actionBar={(c) =>
          selectedIds.length > 1 ? null : (
            <NotesDetailActionBar
              active={active}
              labels={L}
              archived={archived}
              starred={starred}
              closeMobileDetail={c.closeMobileDetail}
              openMoveDialog={(ids) => setMoveDialog({ ids })}
              toggleStar={toggleStar}
              toggleArchive={toggleArchive}
              showCollabChrome={collabSessionActive}
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
          if (!active) return null;
          return (
            <NoteDetailView
              noteId={active.id}
              contentRevision={formatNoteDateForList(active.date)}
              tags={active.tags}
              onTagAdd={() => setTagDialog({ noteId: active.id })}
              onTagRemove={(tag) => toggleNoteTag(active.id, tag)}
              pullQuote={active.pullQuote}
              body={active.body}
              collab={noteBodyCollab}
            />
          );
        }}
        detailFooter={() => {
          if (!showSingleNoteDetail || !active) return null;
          return (
            <NotesDetailFooter
              notebook={active.notebook}
              lastEdited={formatNoteDateForList(active.date)}
              editedLabel="Edited "
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

      <TagPickerDialog
        open={!!tagDialog}
        allTags={tags}
        selected={tagDialog ? (notes.find((note) => note.id === tagDialog.noteId)?.tags ?? []) : []}
        onClose={() => setTagDialog(null)}
        onToggle={(tag) => {
          if (tagDialog) toggleNoteTag(tagDialog.noteId, tag);
        }}
        onCreate={(tag) => {
          if (tagDialog) toggleNoteTag(tagDialog.noteId, tag);
        }}
        contentClassName="notes-dialog-surface"
      />

      {confirmDialog}
    </>
  );
}
