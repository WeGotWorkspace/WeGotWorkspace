import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { Bell, CalendarDays, CircleCheck, Flag, MoreHorizontal, Trash2, Sun } from "lucide-react";
import { ActionBar } from "@/action-bar/src/action-bar";
import { DetailFieldList, DetailFieldRow } from "@/detail-field-row/src/detail-field-row";
import { NoteDetailView } from "@/note-detail-view/src/note-detail-view";
import { NotesNotebookSelect } from "@/notes-core/src/notes-notebook-select";
import { Checkbox } from "@/ui/checkbox";
import { TextareaAutosize } from "@/ui/textarea-autosize";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import type { Task, TaskList } from "@/lib/models/tasks-types";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import { taskListName } from "@/tasks-core/src/tasks-task-utils";
import { isTaskCompleted } from "@/lib/models/task-fields";
import { taskListDotColor } from "@/lib/models/task-lists";
import { taskFieldControls, type TasksTaskFormValue } from "@/tasks-core/src/tasks-task-form";
import { useTaskEditForm } from "@/tasks-core/src/use-task-edit-form";
// The done box shares the list row's mark styles.
import "@/tasks-core/src/tasks-list-panel.css";

/** Typing in the title or notes saves after this pause (and on leaving the task). */
export const TASK_DETAIL_SAVE_DEBOUNCE_MS = 600;

type TasksDetailViewProps = {
  task: Task;
  L: TasksUILabels;
  /** Lists the task can move to (writable). */
  taskLists: TaskList[];
  /** All lists, for the name and colour of the task's own list. */
  allTaskLists: TaskList[];
  readOnly: boolean;
  /** Saves the whole form; runs after a typing pause, right away for a picked value. */
  onSave: (taskId: string, value: TasksTaskFormValue) => void;
  /** The done box left of the title, the same toggle as in the list. */
  onToggleComplete: (taskId: string) => void;
  onCreateList?: () => void;
  /** Asks before the task moves to another list; `move` applies it. */
  onConfirmMove?: (listName: string, move: () => void) => void;
};

/**
 * The open task, laid out like an open note (`NoteDetailView`): its list above the
 * title, a large done box left of it, the notes as the body, then one row per field.
 * Every change saves itself.
 */
export function TasksDetailView({
  task,
  L,
  taskLists,
  allTaskLists,
  readOnly,
  onSave,
  onToggleComplete,
  onCreateList,
  onConfirmMove,
}: TasksDetailViewProps) {
  const [form, setForm] = useTaskEditForm(task, readOnly);
  const formRef = useRef(form);
  formRef.current = form;
  const pendingRef = useRef<{ taskId: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const flush = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingRef.current = null;
    onSaveRef.current(pending.taskId, formRef.current);
  }, []);

  // Leaving the task (another task, closing the pane) saves what was typed.
  useEffect(() => flush, [flush, task.id]);

  const update = useCallback(
    (
      next: TasksTaskFormValue | ((previous: TasksTaskFormValue) => TasksTaskFormValue),
      when: "now" | "later",
    ) => {
      const value = typeof next === "function" ? next(formRef.current) : next;
      formRef.current = value;
      setForm(value);
      const pending = pendingRef.current;
      if (pending) clearTimeout(pending.timer);
      if (when === "now") {
        pendingRef.current = null;
        onSaveRef.current(task.id, value);
        return;
      }
      pendingRef.current = {
        taskId: task.id,
        timer: setTimeout(() => {
          pendingRef.current = null;
          onSaveRef.current(task.id, formRef.current);
        }, TASK_DETAIL_SAVE_DEBOUNCE_MS),
      };
    },
    [setForm, task.id],
  );

  const controls = taskFieldControls({
    L,
    value: form,
    onChange: (next) => update(next, "now"),
    disabled: readOnly,
  });

  const completed = isTaskCompleted(task);
  const completeLabel = completed ? L.markIncomplete : L.markComplete;
  // As in the list row: the tooltip names what a click does, or why it cannot. The
  // trigger is a span, so the tooltip's `data-state` does not replace the box's.
  const completeControl = (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="tasks-detail-view__complete-hint">
          <Checkbox
            mark
            className="tasks-detail-view__complete"
            checked={completed}
            aria-label={completeLabel}
            disabled={readOnly}
            onCheckedChange={() => {
              // What was typed saves first, so the toggle lands on top of it.
              flush();
              onToggleComplete(task.id);
            }}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>{readOnly ? L.viewOnlyListBadge : completeLabel}</TooltipContent>
    </Tooltip>
  );

  const ownList = allTaskLists.find((list) => list.id === form.listId);
  const listItems = taskLists.map((list) => ({
    id: list.id,
    name: list.name,
    color: taskListDotColor(list),
  }));

  return (
    <NoteDetailView
      className="tasks-detail-view"
      noteId={task.id}
      title={form.title}
      titlePlaceholder={L.addTaskName}
      titleLeading={completeControl}
      onTitleChange={
        readOnly ? undefined : (title) => update((prev) => ({ ...prev, title }), "later")
      }
      readOnly={readOnly}
      showTags={false}
      tags={[]}
      eyebrow={
        <NotesNotebookSelect
          notebooks={listItems}
          value={{
            id: form.listId,
            name: taskListName(form.listId, allTaskLists),
            color: taskListDotColor(ownList ?? form.listId),
          }}
          labels={{ addNotebook: L.addList, toolbarMoveToNotebook: L.addTaskList }}
          ariaLabel={L.addTaskList}
          triggerVariant="ghost"
          disabled={readOnly}
          onNotebookChange={(list) => {
            if (list.id === form.listId) return;
            const move = () => update((prev) => ({ ...prev, listId: list.id }), "now");
            if (onConfirmMove) onConfirmMove(list.name, move);
            else move();
          }}
          onCreateNotebook={readOnly ? undefined : onCreateList}
        />
      }
    >
      <TextareaAutosize
        className="tasks-detail-view__notes note-detail-view__notes note-detail-view__body-start"
        value={form.description}
        onChange={(event) =>
          update((prev) => ({ ...prev, description: event.target.value }), "later")
        }
        onBlur={flush}
        placeholder={L.detailNotesPlaceholder}
        aria-label={L.descriptionLabel}
        readOnly={readOnly}
        minRows={2}
        // Grows with the notes, however long: the pane scrolls, not the field.
        maxRows={Number.POSITIVE_INFINITY}
      />
      <DetailFieldList className="tasks-detail-view__fields">
        <TasksDetailField icon={<CircleCheck />} title={L.addTaskStatus}>
          {controls.status}
        </TasksDetailField>
        <TasksDetailField icon={<CalendarDays />} title={L.dueLabel}>
          {controls.due}
        </TasksDetailField>
        {controls.allDay ? (
          <TasksDetailField icon={<Sun />} title={L.dueAllDay}>
            {controls.allDay}
          </TasksDetailField>
        ) : null}
        <TasksDetailField icon={<Flag />} title={L.addTaskPriority}>
          {controls.priority}
        </TasksDetailField>
        {controls.alarms.map((alarm, index) => (
          <TasksDetailField key={index} icon={<Bell />} title={L.detailAlarm(index + 1)}>
            {alarm}
          </TasksDetailField>
        ))}
      </DetailFieldList>
    </NoteDetailView>
  );
}

function TasksDetailField({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <DetailFieldRow className="tasks-detail-view__field" icon={icon} title={title}>
      {children}
    </DetailFieldRow>
  );
}

type TasksDetailActionBarProps = {
  task: Task | null;
  L: TasksUILabels;
  canMutate: boolean;
  /** List / view title shown on the mobile back control. */
  backLabel: string;
  closeMobileDetail: () => void;
  onDeleteTask: (taskId: string) => void;
};

/**
 * Like `NotesDetailActionBar`: back on phones, then delete. Done is the box left
 * of the title, so the bar has no complete action.
 */
export function TasksDetailActionBar({
  task,
  L,
  canMutate,
  backLabel,
  closeMobileDetail,
  onDeleteTask,
}: TasksDetailActionBarProps) {
  if (!task) return null;
  return (
    <ActionBar
      onBack={closeMobileDetail}
      backLabel={backLabel}
      rightActions={[
        {
          id: "delete",
          label: L.delete,
          onClick: canMutate ? () => onDeleteTask(task.id) : undefined,
          icon: <Trash2 />,
          disabled: !canMutate,
        },
      ]}
      rightMenuLabel="More actions"
      rightMenuIcon={<MoreHorizontal />}
    />
  );
}
