import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { IconButton } from "@/button/src/button";
import { Button } from "@/button/src/button";
import { DropdownMenu } from "@/menu-dropdown/src/dropdown-menu";
import type { Task, TaskList } from "@/tasks-core/src/tasks-types";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import { TaskListDot } from "@/tasks-core/src/tasks-list-dot";
import {
  composerDefaultDueForView,
  formatComposerDueDateLabel,
  isTaskCompleted,
  parseDueDateValue,
  taskListName,
  taskListTitle,
  type TaskWorkflowStatus,
} from "@/tasks-core/src/tasks-task-utils";
import { workflowStatusIcon, workflowStatusLabel } from "@/tasks-core/src/tasks-workflow-status";
import { isTaskPriorityNone, priorityIcon, priorityLabel } from "@/tasks-core/src/tasks-priority";
import { TasksRemindIndicator } from "@/tasks-core/src/tasks-remind-picker";
import {
  emptyTaskForm,
  TasksTaskFormFields,
  type TasksCreateInput,
  type TasksTaskFormValue,
} from "@/tasks-core/src/tasks-task-form";

export type { TasksCreateInput, TasksTaskFormValue };

export type TasksMainViewHandle = {
  focusComposerTitle: () => void;
};

type TasksMainViewProps = {
  L: TasksUILabels;
  displayTasks: Task[];
  exitingTaskIds: ReadonlySet<string>;
  taskLists: TaskList[];
  defaultListId: string;
  view: string;
  canCreate: boolean;
  onToggleComplete: (taskId: string) => void;
  onEditTask: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onCreateTask: (input: TasksCreateInput) => void;
  onTaskExitAnimationEnd: (taskId: string) => void;
  itemDragHandlers: (id: string) => Record<string, unknown>;
  isItemDragging: (id: string) => boolean;
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type TaskRowProps = {
  task: Task;
  L: TasksUILabels;
  taskLists: TaskList[];
  isExiting: boolean;
  isDragging: boolean;
  onToggleComplete: (taskId: string) => void;
  onEditTask: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onTaskExitAnimationEnd: (taskId: string) => void;
  itemDragHandlers: (id: string) => Record<string, unknown>;
};

function TaskRow({
  task,
  L,
  taskLists,
  isExiting,
  isDragging,
  onToggleComplete,
  onEditTask,
  onDeleteTask,
  onTaskExitAnimationEnd,
  itemDragHandlers,
}: TaskRowProps) {
  const dragHandlers = itemDragHandlers(task.id) as {
    onDragStart?: (event: DragEvent) => void;
    onDragEnd?: () => void;
  };
  const completed = isTaskCompleted(task);
  const listName = taskListName(task.taskListId, taskLists);
  const taskList = taskLists.find((list) => list.id === task.taskListId);
  const workflowStatus = (task.workflowStatus ?? "needs-action") as TaskWorkflowStatus;
  const dueDate = parseDueDateValue(task.due);
  const dueLabel = dueDate
    ? formatComposerDueDateLabel(dueDate, {
        dueToday: L.dueToday,
        dueYesterday: L.dueYesterday,
        dueTomorrow: L.dueTomorrow,
      })
    : null;

  useEffect(() => {
    if (!isExiting || !prefersReducedMotion()) return;
    onTaskExitAnimationEnd(task.id);
  }, [isExiting, onTaskExitAnimationEnd, task.id]);

  const handleBodyClick = useCallback(() => {
    if (isExiting) return;
    onEditTask(task.id);
  }, [isExiting, onEditTask, task.id]);

  return (
    <div
      role="listitem"
      className={`tasks-main-view__row${isExiting ? " tasks-main-view__row--exiting" : completed ? " tasks-main-view__row--completed" : ""}${isDragging ? " opacity-50" : ""}`}
      draggable={!isExiting}
      onDragStart={dragHandlers.onDragStart}
      onDragEnd={dragHandlers.onDragEnd}
      onAnimationEnd={(event) => {
        if (!isExiting || event.animationName !== "tasks-row-exit") return;
        onTaskExitAnimationEnd(task.id);
      }}
    >
      <button
        type="button"
        className={`tasks-main-view__complete${completed ? " tasks-main-view__complete--done" : ""}`}
        aria-label={completed ? L.markIncomplete : L.markComplete}
        onClick={() => onToggleComplete(task.id)}
        disabled={isExiting}
      >
        {completed ? <CheckCircle2 aria-hidden /> : <Circle aria-hidden />}
      </button>

      <div className="tasks-main-view__body" onClick={handleBodyClick}>
        <p className="tasks-main-view__title">{taskListTitle(task, L.untitledTask)}</p>
        {task.description?.trim() ? (
          <p className="tasks-main-view__description">{task.description}</p>
        ) : null}
        <div className="tasks-main-view__meta">
          {dueLabel ? (
            <span className="tasks-main-view__meta-item">
              <CalendarDays className="size-3.5" aria-hidden />
              <span>{dueLabel}</span>
            </span>
          ) : null}
          <span className="tasks-main-view__meta-item">
            <TaskListDot list={taskList ?? task.taskListId} />
            <span>{listName}</span>
          </span>
          <span className="tasks-main-view__meta-item">
            {workflowStatusIcon(workflowStatus)}
            <span>{workflowStatusLabel(workflowStatus, L)}</span>
          </span>
          {!isTaskPriorityNone(task.priority) ? (
            <span
              className="tasks-main-view__meta-item tasks-main-view__meta-item--priority"
              aria-label={priorityLabel(task.priority, L)}
            >
              {priorityIcon(task.priority)}
            </span>
          ) : null}
          <TasksRemindIndicator labels={L} alerts={task.alerts} />
        </div>
      </div>

      <div className="tasks-main-view__actions" onClick={(event) => event.stopPropagation()}>
        <DropdownMenu
          align="end"
          trigger={
            <IconButton
              label={L.taskActions}
              icon={<MoreVertical className="size-4" />}
              size="sm"
              variant="subtle"
              disabled={isExiting}
            />
          }
          items={[
            {
              id: "edit",
              label: L.editTask,
              icon: <Pencil className="size-4" />,
              onClick: () => onEditTask(task.id),
            },
            {
              id: "delete",
              label: L.delete,
              icon: <Trash2 className="size-4" />,
              onClick: () => onDeleteTask(task.id),
            },
          ]}
        />
      </div>
    </div>
  );
}

export const TasksMainView = forwardRef<TasksMainViewHandle, TasksMainViewProps>(
  function TasksMainView(
    {
      L,
      displayTasks,
      exitingTaskIds,
      taskLists,
      defaultListId,
      view,
      canCreate,
      onToggleComplete,
      onEditTask,
      onDeleteTask,
      onCreateTask,
      onTaskExitAnimationEnd,
      itemDragHandlers,
      isItemDragging,
    },
    ref,
  ) {
    const titleRef = useRef<HTMLInputElement>(null);
    const composerFormRef = useRef<HTMLFormElement>(null);
    const [draft, setDraft] = useState(() => ({
      ...emptyTaskForm(defaultListId),
      due: composerDefaultDueForView(view),
    }));
    const [composerExpanded, setComposerExpanded] = useState(false);
    const viewDefaultDue = composerDefaultDueForView(view);

    useImperativeHandle(
      ref,
      () => ({
        focusComposerTitle: () => {
          titleRef.current?.focus();
          titleRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        },
      }),
      [],
    );

    const resetDraft = useCallback(() => {
      setDraft({
        ...emptyTaskForm(defaultListId),
        due: composerDefaultDueForView(view),
      });
      setComposerExpanded(false);
    }, [defaultListId, view]);

    useEffect(() => {
      setDraft((prev) => ({ ...prev, due: composerDefaultDueForView(view) }));
    }, [view]);

    useEffect(() => {
      setDraft((prev) => {
        const hasContent = prev.title.trim().length > 0 || prev.description.trim().length > 0;
        if (hasContent) {
          if (prev.listId === defaultListId) return prev;
          return { ...prev, listId: defaultListId };
        }
        const listStillValid = taskLists.some((list) => list.id === prev.listId);
        if (listStillValid && prev.listId === defaultListId) return prev;
        return {
          ...emptyTaskForm(defaultListId),
          due: composerDefaultDueForView(view),
        };
      });
    }, [defaultListId, taskLists, view]);

    const handleSubmit = useCallback(
      (event: FormEvent) => {
        event.preventDefault();
        if (!draft.title.trim()) return;
        onCreateTask(draft);
        resetDraft();
        titleRef.current?.focus();
        // Title-Enter already keeps focus; description-Enter would otherwise
        // expand via onTitleFocus. Keep the reset composer collapsed.
        setComposerExpanded(false);
      },
      [draft, onCreateTask, resetDraft],
    );

    const hasDraftContent =
      draft.title.trim().length > 0 ||
      draft.description.trim().length > 0 ||
      (draft.due !== null && draft.due !== viewDefaultDue);

    const showDescription = composerExpanded || draft.description.trim().length > 0;

    return (
      <div className="tasks-main-view">
        <div className="tasks-main-view__scroll">
          <div className="tasks-main-view__list" role="list">
            {displayTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                L={L}
                taskLists={taskLists}
                isExiting={exitingTaskIds.has(task.id)}
                isDragging={isItemDragging(task.id)}
                onToggleComplete={onToggleComplete}
                onEditTask={onEditTask}
                onDeleteTask={onDeleteTask}
                onTaskExitAnimationEnd={onTaskExitAnimationEnd}
                itemDragHandlers={itemDragHandlers}
              />
            ))}

            <form
              ref={composerFormRef}
              className="tasks-main-view__composer"
              onSubmit={handleSubmit}
            >
              <span className="tasks-main-view__composer-marker" aria-hidden>
                <Plus />
              </span>

              <div className="tasks-main-view__composer-body">
                <TasksTaskFormFields
                  L={L}
                  value={draft}
                  onChange={setDraft}
                  taskLists={taskLists}
                  mode="create"
                  disabled={!canCreate}
                  showDescription={showDescription}
                  titleRef={titleRef}
                  onTitleFocus={() => setComposerExpanded(true)}
                  onDescriptionKeyDown={(event) => {
                    if (event.key !== "Enter" || event.shiftKey) return;
                    event.preventDefault();
                    if (!draft.title.trim()) return;
                    composerFormRef.current?.requestSubmit();
                  }}
                />

                <div className="tasks-main-view__composer-actions">
                  {hasDraftContent ? (
                    <Button
                      type="button"
                      variant="subtle"
                      size="sm"
                      onClick={resetDraft}
                      disabled={!canCreate}
                    >
                      {L.cancel}
                    </Button>
                  ) : null}
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    className="tasks-main-view__add-submit"
                    disabled={!canCreate || !draft.title.trim()}
                  >
                    {L.addTaskButton}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  },
);
