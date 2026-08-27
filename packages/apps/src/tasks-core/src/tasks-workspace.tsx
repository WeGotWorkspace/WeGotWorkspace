import { useCallback, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { CheckCircle2, Eye, RefreshCw } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/ui/tooltip";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { CollectionSidebarRow } from "@/collection-sidebar/src/collection-sidebar-row";
import {
  WorkspaceAppLayout,
  WorkspaceUserFooter,
} from "@/workspace-shell/src/workspace-app-layout";
import { ViewHeader } from "@/view-header/src/view-header";
import { workspaceUserInitials } from "@/lib/workspace/workspace-session";
import { getConnectivitySnapshot, subscribeBrowserOnline } from "@/lib/offline/core/browser-online";
import { cn } from "@/lib/utils";
import { useDocumentTitle } from "@/lib/document-title";
import { filterSharePrincipals, sharePrincipalsFromDirectory } from "@/share-ui/collection-share";
import type { CollectionSharePrincipal } from "@/share-ui/collection-share";
import { searchCollectionSharePrincipals } from "@/lib/api/wgw/calendar";
import type { TasksWorkspaceProps } from "@/tasks-core/src/tasks-workspace-props";
import {
  personalOwnerLabel,
  taskProjectGroupsFromBootstrap,
} from "@/tasks-core/src/tasks-workspace-props";
import { TasksMainView, type TasksMainViewHandle } from "@/tasks-core/src/tasks-main-view";
import {
  TaskProjectDialog,
  taskProjectDialogLabelsFrom,
} from "@/tasks-core/src/task-project-dialog";
import { useTasksController } from "@/tasks-core/src/use-tasks-controller";
import {
  isViewOnlyTaskList,
  useTasksSidebarModel,
  type TaskListSidebarEntry,
} from "@/tasks-core/src/use-tasks-sidebar-model";
import { TasksEditDialog } from "@/tasks-core/src/tasks-edit-dialog";
import { TasksNewMenu } from "@/tasks-core/src/tasks-new-menu";
import { canWriteTaskList, taskListDotColor } from "@/tasks-core/src/tasks-task-utils";
import "./tasks-workspace.css";
import "./tasks-main-view.css";

function TasksSidebarMark({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="collection-sidebar-row__mark" role="img" aria-label={label}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function TasksSidebarRows({
  lists,
  view,
  editLabel,
  viewOnlyLabel,
  selectView,
  onEdit,
  sidebarDropZoneProps,
  moveToList,
}: {
  lists: TaskListSidebarEntry[];
  view: string;
  editLabel: string;
  viewOnlyLabel: string;
  selectView: (view: string) => void;
  onEdit: (listId: string) => void;
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
            showColorDot
            onSelect={() => selectView(`list:${list.id}`)}
            onEdit={() => onEdit(list.id)}
            editLabel={editLabel}
            badges={
              viewOnly ? (
                <TasksSidebarMark label={viewOnlyLabel}>
                  <Eye className="size-3.5" aria-hidden />
                </TasksSidebarMark>
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
  onViewChange,
}: TasksWorkspaceProps) {
  const composerRef = useRef<TasksMainViewHandle>(null);
  const online = useSyncExternalStore(subscribeBrowserOnline, getConnectivitySnapshot, () => true);

  const controller = useTasksController({
    data,
    labels,
    operations,
    bootstrapRevision,
    initialView,
    onViewChange,
  });

  const {
    L,
    view,
    viewLabel,
    displayTasks,
    canCreateTask,
    sidebarOpen,
    setSidebarOpen,
    confirmDialog,
    editDialog,
    editingTask,
    closeEditTask,
    saveEditedTask,
    taskLists,
    selectView,
    createTaskFromForm,
    toggleTaskComplete,
    editTask,
    requestDeleteTask,
    moveToList,
    createListId,
    showCompletedTasks,
    showCompletedToggle,
    toggleShowCompletedTasks,
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
  } = controller;

  const projectGroups = taskProjectGroupsFromBootstrap(data);
  const ownerLabel = personalOwnerLabel(session);
  const { topSidebarItems, statusSidebarItems, prioritySidebarItems, ownedLists, sharedLists } =
    useTasksSidebarModel({
      labels: L,
      view,
      taskLists,
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

  const editingTaskWritable = editingTask
    ? canWriteTaskList(taskLists.find((list) => list.id === editingTask.taskListId))
    : true;

  useDocumentTitle(viewLabel);

  return (
    <TooltipProvider delayDuration={300}>
      <WorkspaceAppLayout
        className={cn("tasks-workspace", className)}
        sidebar={
          <AppSidebar
            open={sidebarOpen}
            onCloseMobile={() => setSidebarOpen(false)}
            primaryButton={
              <TasksNewMenu
                labels={L}
                disabled={!canCreateTask}
                onCreateTask={() => {
                  composerRef.current?.focusComposerTitle();
                  setSidebarOpen(false);
                }}
                onCreateList={canManageProjects ? openCreateProjectDialog : undefined}
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
            <SidebarSection items={topSidebarItems} />
            {ownedLists.length > 0 ? (
              <SidebarSection title={L.sidebarProjects}>
                <TasksSidebarRows
                  lists={ownedLists}
                  view={view}
                  editLabel={L.editList}
                  viewOnlyLabel={L.viewOnlyListBadge}
                  selectView={selectView}
                  onEdit={openEditProjectDialog}
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
                  sidebarDropZoneProps={sidebarDropZoneProps}
                  moveToList={moveToList}
                />
              </SidebarSection>
            ) : null}
            <SidebarSection title={L.sidebarStatus} items={statusSidebarItems} />
            <SidebarSection title={L.sidebarPriority} items={prioritySidebarItems} />
          </AppSidebar>
        }
        mainHeader={
          <ViewHeader
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((open) => !open)}
            title={viewLabel}
            subtitle={L.listTasks(displayTasks.length)}
            actions={
              <div className="tasks-workspace__header-actions flex items-center gap-2">
                {showCompletedToggle ? (
                  <IconButton
                    label={showCompletedTasks ? L.hideCompletedTasks : L.showCompletedTasks}
                    onClick={toggleShowCompletedTasks}
                    icon={<CheckCircle2 aria-hidden />}
                    size="sm"
                    variant="subtle"
                    active={showCompletedTasks}
                  />
                ) : null}
                {onRefreshList ? (
                  <IconButton
                    label={L.refreshList}
                    onClick={onRefreshList}
                    disabled={listRefreshing}
                    icon={
                      <RefreshCw className={cn(listRefreshing && "animate-spin")} aria-hidden />
                    }
                    size="sm"
                    variant="subtle"
                  />
                ) : null}
              </div>
            }
          />
        }
        main={
          <TasksMainView
            ref={composerRef}
            L={L}
            displayTasks={displayTasks}
            exitingTaskIds={exitingTaskIds}
            taskLists={writableTaskLists}
            allTaskLists={taskLists}
            defaultListId={createListId}
            view={view}
            canCreate={canCreateTask}
            onToggleComplete={toggleTaskComplete}
            onEditTask={editTask}
            onDeleteTask={requestDeleteTask}
            onTaskExitAnimationEnd={handleTaskExitAnimationEnd}
            onCreateTask={(input) => {
              void createTaskFromForm(input);
            }}
            itemDragHandlers={itemDragHandlers}
            isItemDragging={isItemDragging}
          />
        }
      />
      {confirmDialog}
      <TasksEditDialog
        dialog={editDialog}
        task={editingTask}
        taskLists={editingTaskWritable ? writableTaskLists : taskLists}
        labels={L}
        readOnly={!editingTaskWritable}
        onClose={closeEditTask}
        onSave={(input) => {
          void saveEditedTask(input);
        }}
      />
      <TaskProjectDialog
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
        labels={taskProjectDialogLabelsFrom(L)}
        contentClassName="tasks-dialog-surface"
      />
    </TooltipProvider>
  );
}
