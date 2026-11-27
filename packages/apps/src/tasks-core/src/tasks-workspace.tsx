import { useCallback, useMemo, useRef, useSyncExternalStore, type ChangeEvent } from "react";
import { Eye, ListTodo } from "lucide-react";
import { TooltipProvider } from "@/ui/tooltip";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import {
  CollectionSidebarMark,
  CollectionSidebarRow,
} from "@/collection-sidebar/src/collection-sidebar-row";
import { ActionBar } from "@/action-bar/src/action-bar";
import { CollectionState } from "@/collection-state/src/collection-state";
import { MultiSelectionView } from "@/multi-selection-view/src/multi-selection-view";
import { ChangeNotebookDialog } from "@/project-dialog/src/change-notebook-dialog";
import { WorkspaceApp } from "@/workspace-app/src/workspace-app";
import { WorkspaceSidebarAccountFooter } from "@/workspace-shell/src/workspace-app-layout";
import { getConnectivitySnapshot, subscribeBrowserOnline } from "@/lib/offline/core/browser-online";
import { cn } from "@/lib/utils";
import { useDocumentTitle } from "@/lib/document-title";
import { useIsTouch } from "@/hooks/use-is-touch";
import {
  filterSharePrincipals,
  sharePrincipalsFromDirectory,
  viewerHasNoTeam,
} from "@/lib/sharing/collection-share";
import type { CollectionSharePrincipal } from "@/lib/sharing/collection-share";
import { searchCollectionSharePrincipals } from "@/lib/api/wgw/calendar";
import type { TasksWorkspaceProps } from "@/tasks-core/src/tasks-workspace-props";
import { taskProjectGroupsFromBootstrap } from "@/tasks-core/src/tasks-workspace-props";
import { personalOwnerLabel } from "@/lib/workspace/workspace-session";
import { ProjectDialog } from "@/project-dialog/src/project-dialog";
import { taskProjectDialogLabelsFrom } from "@/tasks-core/src/tasks-project-dialog-labels";
import { useTaskDetailLiveText } from "@/tasks-core/src/use-task-detail-live-text";
import { useTasksController } from "@/tasks-core/src/use-tasks-controller";
import { isViewOnlyTaskList, useTasksSidebarModel } from "@/tasks-core/src/use-tasks-sidebar-model";
import { TasksNewMenu } from "@/tasks-core/src/tasks-new-menu";
import { TasksImportDialog } from "@/tasks-core/src/tasks-import-dialog";
import { dismissSidebarOverlay } from "@/workspace-shell/src/sidebar-breakpoint";
import { ICS_FILE_ACCEPT, icsFileFromList } from "@/lib/ics-import/ics-file";
import { TasksListPanel } from "@/tasks-core/src/tasks-list-panel";
import { TasksDetailActionBar, TasksDetailView } from "@/tasks-core/src/tasks-detail-view";
import { useQuickAddTarget } from "@/tasks-core/src/use-quick-add-target";
import { TasksThreadSection } from "@/tasks-core/src/tasks-thread-section";
import { CollabSessionPresence } from "@/text-editor-core/docs-collab";
import { isProjectOwnedTaskList } from "@/tasks-core/src/tasks-task-utils";
import {
  canWriteTaskList,
  taskListDotColor,
  type TaskListSidebarEntry,
} from "@/lib/models/task-lists";
import "./tasks-workspace.css";

function TasksSidebarRows({
  lists,
  view,
  editLabel,
  viewOnlyLabel,
  selectView,
  onEdit,
  hiddenTaskListIds,
  onToggleVisibility,
  sidebarDropZoneProps,
  moveToList,
}: {
  lists: TaskListSidebarEntry[];
  view: string;
  editLabel: string;
  viewOnlyLabel: string;
  selectView: (view: string) => void;
  onEdit: (listId: string) => void;
  hiddenTaskListIds: ReadonlySet<string>;
  onToggleVisibility: (listId: string) => void;
  sidebarDropZoneProps: (
    target: string,
    onDrop: (ids: string[]) => void,
  ) => Record<string, unknown>;
  moveToList: (ids: string[], listId: string) => void;
}) {
  return (
    <>
      {lists.map((list) => {
        const viewOnly = isViewOnlyTaskList(list);
        const dropProps = viewOnly
          ? undefined
          : sidebarDropZoneProps(`list:${list.id}`, (ids) => moveToList(ids, list.id));
        const { isDropTarget, ...dropHandlers } = (dropProps ?? {}) as {
          isDropTarget?: boolean;
        } & Record<string, unknown>;
        return (
          <CollectionSidebarRow
            key={list.id}
            name={list.name}
            color={taskListDotColor(list)}
            selected={view === `list:${list.id}`}
            visible={!hiddenTaskListIds.has(list.id)}
            onToggleVisibility={() => onToggleVisibility(list.id)}
            onSelect={() => selectView(`list:${list.id}`)}
            onEdit={isProjectOwnedTaskList(list) ? undefined : () => onEdit(list.id)}
            editLabel={editLabel}
            badges={
              viewOnly ? (
                <CollectionSidebarMark label={viewOnlyLabel}>
                  <Eye className="size-3.5" aria-hidden />
                </CollectionSidebarMark>
              ) : null
            }
            rootProps={{
              ...dropHandlers,
              className: isDropTarget ? "collection-sidebar-row--drop-target" : undefined,
            }}
          />
        );
      })}
    </>
  );
}

export function TasksWorkspace({
  data,
  session,
  labels,
  operations,
  listRefreshing = false,
  bootstrapRevision = 0,
  onRefreshList,
  onLogout,
  className,
  initialView,
  initialTaskId,
  onViewChange,
  notice,
}: TasksWorkspaceProps) {
  const quickAddRef = useRef<HTMLInputElement>(null);
  const icsFileInputRef = useRef<HTMLInputElement>(null);
  const online = useSyncExternalStore(subscribeBrowserOnline, getConnectivitySnapshot, () => true);
  const isTouch = useIsTouch();

  const viewer = useMemo(
    () => ({ username: session.user.username, email: session.user.email }),
    [session.user.username, session.user.email],
  );
  const controller = useTasksController({
    data,
    labels,
    operations,
    bootstrapRevision,
    initialView,
    initialTaskId,
    onViewChange,
    viewer,
  });

  const {
    L,
    view,
    viewLabel,
    canCreateTask,
    workspaceLayoutRef,
    searchInputRef,
    confirmDialog,
    requestMoveTask,
    activeId,
    activeTask,
    closeTask,
    selectedIds,
    selectionMode,
    handleSelect,
    enterSelectionFor,
    selectionBar,
    selectionBarButtons,
    moveDialog,
    setMoveDialog,
    searchQuery,
    setSearchQuery,
    listTasks,
    autosaveTask,
    taskLists,
    selectView,
    createTaskFromForm,
    toggleTaskComplete,
    requestDeleteTask,
    moveToList,
    createListId,
    hiddenTaskListIds,
    toggleTaskListVisibility,
    statusFilter,
    priorityFilter,
    statusFilterApplies,
    assigneePeople,
    toggleStatusFilter,
    togglePriorityFilter,
    exitingTaskIds,
    isItemDragging,
    itemDragHandlers,
    sidebarDropZoneProps,
    handleTaskExitAnimationEnd,
    canManageProjects,
    projectDialog,
    setProjectDialog,
    openCreateProjectDialog,
    openEditProjectDialog,
    createProject,
    updateProject,
    patchShareWith,
    removeSharedList,
    deleteList,
    icsImport,
    showLiveText,
  } = controller;

  const projectGroups = taskProjectGroupsFromBootstrap(data);
  const ownerLabel = personalOwnerLabel(session);
  const meRow = useMemo(
    () => ({
      username: session.user.username?.trim() || "me",
      name: session.user.displayName?.trim() || session.user.username?.trim() || "Me",
    }),
    [session.user.displayName, session.user.username],
  );

  const quickAddTarget = useQuickAddTarget({
    view,
    taskLists,
    defaultListId: createListId,
    me: {
      username: meRow.username,
      displayName: meRow.name,
      email: session.user.email ?? null,
    },
    loadMembers: operations?.listTaskListMembers,
    createTask: createTaskFromForm,
  });
  const { topSidebarItems, assignedToItems, ownedLists, sharedLists } = useTasksSidebarModel({
    labels: L,
    view,
    taskLists,
    assigneePeople,
    me: meRow,
    selectView,
  });

  const writableTaskLists = useMemo(
    () => taskLists.filter((list) => canWriteTaskList(list)),
    [taskLists],
  );

  const knownSharePrincipals = useMemo(
    () =>
      sharePrincipalsFromDirectory({
        groups: projectGroups,
        excludeId: session.user.username,
      }),
    [projectGroups, session.user.username],
  );

  const searchSharePrincipals = useCallback(
    async (query: string): Promise<CollectionSharePrincipal[]> => {
      if (operations?.searchSharePrincipals) {
        return operations.searchSharePrincipals(query);
      }
      if (online) {
        return searchCollectionSharePrincipals(query, session.user.username);
      }
      return filterSharePrincipals(query, knownSharePrincipals);
    },
    [knownSharePrincipals, online, operations, session.user.username],
  );

  const activeTaskWritable = activeTask
    ? canWriteTaskList(taskLists.find((list) => list.id === activeTask.taskListId))
    : true;
  const multiSelected = selectedIds.length > 1;
  const editingTask = multiSelected ? null : activeTask;
  const liveText = useTaskDetailLiveText({
    task: editingTask,
    taskLists,
    username: session.user.username,
    displayName: session.user.displayName,
    showLiveText,
  });

  const moveTargets = useMemo(
    () =>
      writableTaskLists.map((list) => ({
        id: list.id,
        name: list.name,
        color: taskListDotColor(list),
      })),
    [writableTaskLists],
  );
  const moveValue = useMemo(() => {
    const ids = moveDialog?.ids ?? [];
    const listIds = new Set(
      listTasks.filter((task) => ids.includes(task.id)).map((task) => task.taskListId),
    );
    // One shared list is the starting value; a mixed selection starts empty.
    const only = listIds.size === 1 ? moveTargets.find((list) => listIds.has(list.id)) : undefined;
    return only ?? { name: "" };
  }, [listTasks, moveDialog, moveTargets]);

  useDocumentTitle(viewLabel);

  return (
    <TooltipProvider delayDuration={300}>
      <WorkspaceApp
        ref={workspaceLayoutRef}
        initialDetailOpenMobile={Boolean(initialTaskId)}
        detailScrollResetKey={activeId}
        workspaceRoot={{ className: cn("tasks-workspace note-detail-desk", className) }}
        sidebar={(c) => (
          <AppSidebar
            settingsAppId="tasks"
            open={c.sidebarOpen}
            onCloseMobile={c.closeSidebar}
            primaryButton={
              <TasksNewMenu
                labels={L}
                disabled={!canCreateTask}
                onCreateTask={() => {
                  c.closeSidebar();
                  workspaceLayoutRef.current?.closeMobileDetail();
                  quickAddRef.current?.focus();
                }}
                onCreateList={canManageProjects ? openCreateProjectDialog : undefined}
                onImportTasks={
                  icsImport.canImportTasks
                    ? () => {
                        dismissSidebarOverlay(c.closeSidebar);
                        icsFileInputRef.current?.click();
                      }
                    : undefined
                }
                importOffline={!online}
              />
            }
            footer={<WorkspaceSidebarAccountFooter session={session} onLogout={onLogout} />}
          >
            <SidebarSection items={topSidebarItems} />
            <SidebarSection title={L.sidebarAssignedTo} items={assignedToItems} />
            {ownedLists.length > 0 ? (
              <SidebarSection title={L.sidebarProjects}>
                <TasksSidebarRows
                  lists={ownedLists}
                  view={view}
                  editLabel={L.editList}
                  viewOnlyLabel={L.viewOnlyListBadge}
                  selectView={selectView}
                  onEdit={openEditProjectDialog}
                  hiddenTaskListIds={hiddenTaskListIds}
                  onToggleVisibility={toggleTaskListVisibility}
                  sidebarDropZoneProps={sidebarDropZoneProps}
                  moveToList={moveToList}
                />
              </SidebarSection>
            ) : null}
            {sharedLists.length > 0 ? (
              <SidebarSection title={L.sidebarSharedWithMe}>
                <TasksSidebarRows
                  lists={sharedLists}
                  view={view}
                  editLabel={L.editList}
                  viewOnlyLabel={L.viewOnlyListBadge}
                  selectView={selectView}
                  onEdit={openEditProjectDialog}
                  hiddenTaskListIds={hiddenTaskListIds}
                  onToggleVisibility={toggleTaskListVisibility}
                  sidebarDropZoneProps={sidebarDropZoneProps}
                  moveToList={moveToList}
                />
              </SidebarSection>
            ) : null}
          </AppSidebar>
        )}
        list={(c) =>
          TasksListPanel({
            L,
            sidebarOpen: c.sidebarOpen,
            onToggleSidebar: c.toggleSidebar,
            viewLabel,
            displayTasks: listTasks,
            exitingTaskIds,
            taskLists,
            activeId,
            selectedIds,
            selectionMode,
            isTouch,
            searchQuery,
            setSearchQuery,
            searchInputRef,
            statusFilter,
            priorityFilter,
            statusFilterApplies,
            onToggleStatusFilter: toggleStatusFilter,
            onTogglePriorityFilter: togglePriorityFilter,
            listRefreshing,
            onRefreshList,
            notice,
            canCreate: canCreateTask && quickAddTarget.canAdd,
            quickAddLists: quickAddTarget.lists,
            quickAddListId: quickAddTarget.listId,
            onQuickAddListChange: quickAddTarget.setListId,
            quickAddPlaceholder: quickAddTarget.noSharedList ? L.quickAddNoSharedList : undefined,
            quickAddRef,
            onQuickAdd: quickAddTarget.add,
            handleSelect,
            enterSelectionFor,
            selectionBar,
            onToggleComplete: toggleTaskComplete,
            onDeleteTask: requestDeleteTask,
            onTaskExitAnimationEnd: handleTaskExitAnimationEnd,
            itemDragHandlers,
            isItemDragging,
          })
        }
        actionBar={(c) =>
          editingTask ? (
            <TasksDetailActionBar
              task={editingTask}
              L={L}
              canMutate={activeTaskWritable}
              backLabel={viewLabel}
              closeMobileDetail={closeTask}
              onDeleteTask={requestDeleteTask}
              presence={
                liveText.textPresence ? (
                  <CollabSessionPresence variant="header" {...liveText.textPresence} />
                ) : undefined
              }
            />
          ) : c.detailOpenMobile ? (
            <ActionBar onBack={closeTask} backLabel={viewLabel} />
          ) : null
        }
        detail={() =>
          multiSelected ? (
            <MultiSelectionView
              count={selectedIds.length}
              label={L.selectionLabel}
              title={L.selectionTitle}
              actions={selectionBarButtons}
            />
          ) : editingTask ? (
            <TasksDetailView
              key={editingTask.id}
              task={editingTask}
              L={L}
              taskLists={activeTaskWritable ? writableTaskLists : taskLists}
              allTaskLists={taskLists}
              readOnly={!activeTaskWritable}
              onSave={(taskId, value, opts) => {
                void autosaveTask(taskId, value, opts);
              }}
              onToggleComplete={toggleTaskComplete}
              onCreateList={canManageProjects ? openCreateProjectDialog : undefined}
              onConfirmMove={requestMoveTask}
              loadListMembers={operations?.listTaskListMembers}
              viewerUsername={session.user.username ?? undefined}
              textCollab={liveText.textCollab}
              textAccessLost={liveText.textAccessLost}
              textLookingUp={liveText.textLookingUp}
              onLiveText={liveText.onLiveText}
              footer={
                <TasksThreadSection
                  key={`${editingTask.id}:${editingTask.taskListId}`}
                  task={editingTask}
                  canPost={activeTaskWritable}
                  session={session}
                />
              }
              onPresence={liveText.onPresence}
            />
          ) : (
            <CollectionState icon={<ListTodo className="size-12" />}>
              {L.selectTask}
            </CollectionState>
          )
        }
      />
      {confirmDialog}
      <ChangeNotebookDialog
        open={!!moveDialog}
        notebooks={moveTargets}
        value={moveValue}
        title={L.selectionMoveToList}
        fieldLabel={L.importDestinationLegend}
        description={L.selectionMoveDescription}
        confirmLabel={L.moveConfirm}
        labels={{
          addNotebook: L.addList,
          toolbarMoveToNotebook: L.addTaskList,
          selectionMoveToNotebook: L.selectionMoveToList,
          changeNotebookConfirm: L.moveConfirm,
          dialogCancel: L.cancel,
        }}
        contentClassName="tasks-dialog-surface"
        onClose={() => setMoveDialog(null)}
        onNotebookChange={(target) => {
          if (moveDialog) moveToList(moveDialog.ids, target.id);
        }}
      />
      <ProjectDialog
        dialog={projectDialog}
        groups={projectGroups}
        personalOwnerLabel={ownerLabel}
        onClose={() => setProjectDialog(null)}
        onConfirm={(input) => {
          if (!projectDialog) return;
          if (projectDialog.mode === "create") {
            void createProject(input);
            return;
          }
          void updateProject(projectDialog.listId, input);
        }}
        share={
          projectDialog?.mode === "edit" && projectDialog.mayShare
            ? {
                knownPrincipals: knownSharePrincipals,
                online,
                noTeam: viewerHasNoTeam(data.groups),
                onSearchPrincipals: searchSharePrincipals,
                onPatchShareWith: patchShareWith,
              }
            : undefined
        }
        onRemoveShared={
          projectDialog?.mode === "edit" && projectDialog.isSharee
            ? () => {
                void removeSharedList(projectDialog.listId);
              }
            : undefined
        }
        onDelete={
          projectDialog?.mode === "edit" && projectDialog.mayDelete
            ? () => {
                void deleteList(projectDialog.listId);
              }
            : undefined
        }
        labels={taskProjectDialogLabelsFrom(L)}
        contentClassName="tasks-dialog-surface"
      />
      <input
        ref={icsFileInputRef}
        type="file"
        accept={ICS_FILE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="tasks-ics-file-input"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const file = icsFileFromList(event.target.files);
          event.target.value = "";
          if (file) icsImport.beginImport(file);
        }}
      />
      {icsImport.importFile ? (
        <TasksImportDialog
          open
          file={icsImport.importFile}
          labels={L}
          taskLists={taskLists}
          preferredTaskListId={view.startsWith("list:") ? view.slice("list:".length) : undefined}
          busy={icsImport.importDialogBusy}
          error={icsImport.importDialogError}
          offline={!online}
          result={icsImport.importResult}
          onClose={icsImport.closeImportDialog}
          onImport={icsImport.submitImportDialog}
        />
      ) : null}
    </TooltipProvider>
  );
}
