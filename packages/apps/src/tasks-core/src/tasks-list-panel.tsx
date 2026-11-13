import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import { ICON_BUTTON_ACTIVE_CLASSNAME } from "@/button/src/button.shared";
import { Input } from "@/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { ViewHeader } from "@/view-header/src/view-header";
import { RefreshSpinIcon } from "@/refresh-spin/src/refresh-spin-icon";
import { bindItemDragHandlers } from "@/list-item/src/use-delegated-list-item-events";
import { WorkspaceList } from "@/workspace-list/src/workspace-list";
import { cn } from "@/lib/utils";
import type { Task, TaskList } from "@/lib/models/tasks-types";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import { canWriteTaskList } from "@/tasks-core/src/tasks-task-utils";
import { TasksListRow } from "@/tasks-core/src/tasks-list-row";
import "@/tasks-core/src/tasks-list-panel.css";

const taskKey = (task: Task) => task.id;
/**
 * A row's pitch (row plus gap) before it is measured, at a 16px root: title and
 * meta lines, plus two lines of notes excerpt when the task has notes. Measured rows
 * correct the rest (a one-line excerpt, another root size or zoom).
 */
const TASKS_ROW_ESTIMATE_PX = 76.875;
const TASKS_ROW_WITH_NOTES_ESTIMATE_PX = 119.375;
const taskRowEstimate = (task: Task) =>
  task.description?.trim() ? TASKS_ROW_WITH_NOTES_ESTIMATE_PX : TASKS_ROW_ESTIMATE_PX;

export type TasksListPanelProps = {
  L: TasksUILabels;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  viewLabel: string;
  /** Rows to show (view, completed toggle and search already applied). */
  displayTasks: Task[];
  exitingTaskIds: ReadonlySet<string>;
  taskLists: TaskList[];
  activeId: string;
  selectedIds: string[];
  selectionMode: boolean;
  isTouch: boolean;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  showCompletedToggle: boolean;
  showCompletedTasks: boolean;
  onToggleShowCompleted: () => void;
  listRefreshing: boolean;
  onRefreshList?: () => void;
  /** A notice above the list (sync failed). */
  notice?: ReactNode;
  canCreate: boolean;
  quickAddRef: RefObject<HTMLInputElement | null>;
  onQuickAdd: (title: string) => void;
  /** A click on a row: open it, or with Cmd/Shift (or in selection mode) select it. */
  handleSelect: (taskId: string, event: ReactMouseEvent) => void;
  /** A long-press: start selecting from this row. */
  enterSelectionFor: (taskId: string) => void;
  /** The shared floating selection bar (phone). */
  selectionBar?: ReactNode;
  onToggleComplete: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onTaskExitAnimationEnd: (taskId: string) => void;
  itemDragHandlers: (id: string) => Record<string, unknown>;
  isItemDragging: (id: string) => boolean;
};

/**
 * The Tasks list column, built like `NotesListPanel`: the pane header with the
 * count, actions and the floating search; a quick add field; the rows.
 */
export function TasksListPanel({
  L,
  sidebarOpen,
  onToggleSidebar,
  viewLabel,
  displayTasks,
  exitingTaskIds,
  taskLists,
  activeId,
  selectedIds,
  selectionMode,
  isTouch,
  searchQuery,
  setSearchQuery,
  searchInputRef,
  showCompletedToggle,
  showCompletedTasks,
  onToggleShowCompleted,
  listRefreshing,
  onRefreshList,
  notice,
  canCreate,
  quickAddRef,
  onQuickAdd,
  handleSelect,
  enterSelectionFor,
  selectionBar,
  onToggleComplete,
  onDeleteTask,
  onTaskExitAnimationEnd,
  itemDragHandlers,
  isItemDragging,
}: TasksListPanelProps) {
  const multiSelecting = selectionMode || selectedIds.length > 1;
  const count = multiSelecting ? selectedIds.length : displayTasks.length;
  const countLabel = multiSelecting ? L.listSelected(count) : L.listTasks(count);
  return {
    header: (
      <ViewHeader
        sidebarOpen={sidebarOpen}
        onToggleSidebar={onToggleSidebar}
        title={viewLabel}
        titleSuffix={
          <span className="view-header__title-count" aria-label={countLabel}>
            ({count})
          </span>
        }
        actions={
          <div className="tasks-list-panel__header-actions flex items-center gap-2">
            {showCompletedToggle ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton
                    className={cn(
                      "tasks-list-panel__show-completed",
                      showCompletedTasks && ICON_BUTTON_ACTIVE_CLASSNAME,
                    )}
                    label={showCompletedTasks ? L.hideCompletedTasks : L.showCompletedTasks}
                    onClick={onToggleShowCompleted}
                    icon={<CheckCircle2 className="size-4" aria-hidden />}
                    size="md"
                    variant="outline"
                    aria-pressed={showCompletedTasks}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  {showCompletedTasks ? L.hideCompletedTasks : L.showCompletedTasks}
                </TooltipContent>
              </Tooltip>
            ) : null}
            {onRefreshList ? (
              <IconButton
                label={L.refreshList}
                onClick={onRefreshList}
                disabled={listRefreshing}
                icon={<RefreshSpinIcon spinning={listRefreshing} className="size-4" />}
                size="md"
                variant="outline"
              />
            ) : null}
          </div>
        }
        searchPlaceholder={L.searchPlaceholder}
        searchValue={searchQuery}
        onSearchInput={setSearchQuery}
        searchInputRef={searchInputRef}
        searchHidden={multiSelecting}
      />
    ),
    listTop: (
      <>
        {notice}
        <TasksQuickAdd L={L} disabled={!canCreate} inputRef={quickAddRef} onAdd={onQuickAdd} />
      </>
    ),
    listContent: (
      <TasksListRows
        L={L}
        displayTasks={displayTasks}
        exitingTaskIds={exitingTaskIds}
        taskLists={taskLists}
        activeId={activeId}
        selectedIds={selectedIds}
        selectionMode={selectionMode}
        isTouch={isTouch}
        handleSelect={handleSelect}
        enterSelectionFor={enterSelectionFor}
        onToggleComplete={onToggleComplete}
        onDeleteTask={onDeleteTask}
        onTaskExitAnimationEnd={onTaskExitAnimationEnd}
        itemDragHandlers={itemDragHandlers}
        isItemDragging={isItemDragging}
      />
    ),
    hasItems: count > 0,
    emptyLabel: L.emptyList,
    floatingActionBar: selectionBar,
  };
}

/** "Create a task… (Press Enter)": a title only; the rest is set in the detail pane. */
function TasksQuickAdd({
  L,
  disabled,
  inputRef,
  onAdd,
}: {
  L: TasksUILabels;
  disabled: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onAdd: (title: string) => void;
}) {
  const [title, setTitle] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setTitle("");
  };
  return (
    <form className="tasks-list-panel__quick-add" onSubmit={submit}>
      <CircleDashed className="tasks-list-panel__quick-add-icon" aria-hidden />
      <Input
        ref={inputRef}
        size="lg"
        className="tasks-list-panel__quick-add-input"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={L.quickAddPlaceholder}
        aria-label={L.quickAddLabel}
        disabled={disabled}
        enterKeyHint="done"
      />
      {/* Enter submits; the button is for screen readers and keeps the form submittable. */}
      <Button type="submit" className="sr-only" disabled={disabled || !title.trim()}>
        {L.addTaskButton}
      </Button>
    </form>
  );
}

function TasksListRows({
  L,
  displayTasks,
  exitingTaskIds,
  taskLists,
  activeId,
  selectedIds,
  selectionMode,
  isTouch,
  handleSelect,
  enterSelectionFor,
  onToggleComplete,
  onDeleteTask,
  onTaskExitAnimationEnd,
  itemDragHandlers,
  isItemDragging,
}: Pick<
  TasksListPanelProps,
  | "L"
  | "displayTasks"
  | "exitingTaskIds"
  | "taskLists"
  | "activeId"
  | "selectedIds"
  | "selectionMode"
  | "isTouch"
  | "handleSelect"
  | "enterSelectionFor"
  | "onToggleComplete"
  | "onDeleteTask"
  | "onTaskExitAnimationEnd"
  | "itemDragHandlers"
  | "isItemDragging"
>) {
  // Rows are memoized per task: hand them handlers that keep their identity.
  const handlersRef = useRef({ onToggleComplete, onDeleteTask, onTaskExitAnimationEnd });
  handlersRef.current = { onToggleComplete, onDeleteTask, onTaskExitAnimationEnd };
  const toggleComplete = useCallback((id: string) => handlersRef.current.onToggleComplete(id), []);
  const deleteTask = useCallback((id: string) => handlersRef.current.onDeleteTask(id), []);
  const exitAnimationEnd = useCallback(
    (id: string) => handlersRef.current.onTaskExitAnimationEnd(id),
    [],
  );

  const listsById = useMemo(() => new Map(taskLists.map((list) => [list.id, list])), [taskLists]);
  const multiSelect = selectionMode || selectedIds.length > 1;
  // As in Notes: only the single open task paints as active.
  const paintActiveId = !multiSelect && selectedIds.includes(activeId) ? activeId : "";

  // Called only for the rows the list mounts (#1641 step d).
  const renderTask = useCallback(
    (task: Task) => {
      const taskList = listsById.get(task.taskListId);
      return (
        <TasksListRow
          task={task}
          L={L}
          taskList={taskList}
          taskLists={taskLists}
          canMutate={canWriteTaskList(taskList)}
          isTouch={isTouch}
          isExiting={exitingTaskIds.has(task.id)}
          dragging={isItemDragging(task.id)}
          onToggleComplete={toggleComplete}
          onDeleteTask={deleteTask}
          onExitAnimationEnd={exitAnimationEnd}
        />
      );
    },
    [
      L,
      deleteTask,
      exitAnimationEnd,
      exitingTaskIds,
      isItemDragging,
      isTouch,
      listsById,
      taskLists,
      toggleComplete,
    ],
  );
  // The keyboard cursor stays mounted, and so does a row on its way out: its exit
  // animation must end, or the task never leaves the list.
  const pinnedKeys = useMemo(
    () => [...(activeId ? [activeId] : []), ...exitingTaskIds],
    [activeId, exitingTaskIds],
  );

  return (
    <WorkspaceList
      className="tasks-list-panel__list"
      items={displayTasks}
      getKey={taskKey}
      renderItem={renderTask}
      estimateSize={taskRowEstimate}
      pinnedKeys={pinnedKeys}
      isTouch={isTouch}
      activeId={paintActiveId}
      selectedIds={selectedIds}
      selectionMode={multiSelect}
      onItemClick={handleSelect}
      onItemLongPress={enterSelectionFor}
      {...bindItemDragHandlers(itemDragHandlers)}
    />
  );
}
