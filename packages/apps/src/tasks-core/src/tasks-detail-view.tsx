import { useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  Bell,
  CalendarDays,
  CircleCheck,
  Flag,
  MoreHorizontal,
  Trash2,
  Check,
  Sun,
} from "lucide-react";
import { ActionBar } from "@/action-bar/src/action-bar";
import { CardRow } from "@/card/src/card-row";
import { NoteDetailView } from "@/note-detail-view/src/note-detail-view";
import { NotesNotebookSelect } from "@/notes-core/src/notes-notebook-select";
import { TextareaAutosize } from "@/ui/textarea-autosize";
import type { Task, TaskList } from "@/tasks-core/src/tasks-types";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import { isTaskCompleted, taskListDotColor, taskListName } from "@/tasks-core/src/tasks-task-utils";
import { taskFieldControls, type TasksTaskFormValue } from "@/tasks-core/src/tasks-task-form";
import { useTaskEditForm } from "@/tasks-core/src/use-task-edit-form";
import "@/tasks-core/src/tasks-detail-view.css";

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
  onCreateList?: () => void;
};

/**
 * The open task, laid out like an open note (`NoteDetailView`): its list above the
 * title, the notes as the body, then one row per field. Every change saves itself.
 */
export function TasksDetailView({
  task,
  L,
  taskLists,
  allTaskLists,
  readOnly,
  onSave,
  onCreateList,
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
          onNotebookChange={(list) => update((prev) => ({ ...prev, listId: list.id }), "now")}
          onCreateNotebook={readOnly ? undefined : onCreateList}
        />
      }
    >
      <TextareaAutosize
        className="tasks-detail-view__notes note-detail-view__body-start"
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
      <div className="tasks-detail-view__fields">
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
      </div>
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
    <CardRow
      className="tasks-detail-view__field"
      leading={<span className="tasks-detail-view__field-icon">{icon}</span>}
      title={title}
    >
      {children}
    </CardRow>
  );
}

type TasksDetailActionBarProps = {
  task: Task | null;
  L: TasksUILabels;
  canMutate: boolean;
  /** List / view title shown on the mobile back control. */
  backLabel: string;
  closeMobileDetail: () => void;
  onToggleComplete: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
};

/** Like `NotesDetailActionBar`: back on phones, then complete and delete. */
export function TasksDetailActionBar({
  task,
  L,
  canMutate,
  backLabel,
  closeMobileDetail,
  onToggleComplete,
  onDeleteTask,
}: TasksDetailActionBarProps) {
  if (!task) return null;
  const completed = isTaskCompleted(task);
  return (
    <ActionBar
      onBack={closeMobileDetail}
      backLabel={backLabel}
      rightActions={[
        {
          id: "toggle-complete",
          label: completed ? L.markIncomplete : L.markComplete,
          onClick: canMutate ? () => onToggleComplete(task.id) : undefined,
          active: completed,
          icon: <Check />,
          disabled: !canMutate,
        },
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
