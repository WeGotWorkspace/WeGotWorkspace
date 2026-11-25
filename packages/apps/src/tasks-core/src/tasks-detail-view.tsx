import { useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  Bell,
  CalendarDays,
  CircleCheck,
  Flag,
  MoreHorizontal,
  Trash2,
  Sun,
  User,
  X,
} from "lucide-react";
import { ActionBar } from "@/action-bar/src/action-bar";
import { DetailFieldList, DetailFieldRow } from "@/detail-field-row/src/detail-field-row";
import { NoteDetailView } from "@/note-detail-view/src/note-detail-view";
import { NotebookSelect } from "@/project-dialog/src/notebook-select";
import { Checkbox } from "@/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import type { Task, TaskList, TaskListMembersResult } from "@/lib/models/tasks-types";
import { TasksAssigneesField } from "@/tasks-core/src/tasks-assignees-field";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import { taskListName } from "@/tasks-core/src/tasks-task-utils";
import { isTaskCompleted } from "@/lib/models/task-fields";
import { taskListDotColor } from "@/lib/models/task-lists";
import { taskFieldControls, type TasksTaskFormValue } from "@/tasks-core/src/tasks-task-form";
import { useTaskEditForm } from "@/tasks-core/src/use-task-edit-form";
import { Callout } from "@/callout/src/callout";
import { TaskDescriptionField } from "@/tasks-core/src/task-description-field";
import { TaskTextSession, useTaskTextSession } from "@/tasks-core/src/task-text-session";
import type { TaskTextCollabConfig } from "@/tasks-core/src/use-task-text-collab";
import type { TextFieldsText } from "@/text-editor-core/docs-collab/docs-collab-text-fields";
import type { CollabSessionPresenceSource } from "@/text-editor-core/docs-collab";
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
  onSave: (taskId: string, value: TasksTaskFormValue, opts?: { skipText?: boolean }) => void;
  /** The done box left of the title, the same toggle as in the list. */
  onToggleComplete: (taskId: string) => void;
  onCreateList?: () => void;
  /** Asks before the task moves to another list; `move` applies it. */
  onConfirmMove?: (listName: string, move: () => void, fromListName?: string) => void;
  /** Under the fields: the task's comments (#2173). */
  footer?: ReactNode;
  /** The list audience for the assignee picker (#2172). */
  loadListMembers?: (taskListId: string) => Promise<TaskListMembersResult>;
  /** The signed-in username: that person shows as "(Me)" in the assignee field and picker. */
  viewerUsername?: string;
  /**
   * The live room for the title and description (#2208). While it is open
   * they are typed together and saved by the room; the other fields keep the
   * autosave. Without it (mock, Storybook, a queued create) both autosave.
   */
  textCollab?: TaskTextCollabConfig;
  /** The room refused this person: the fields are read-only, with a notice. */
  textAccessLost?: boolean;
  /** The task's room is being looked up: the title and notes wait for it. */
  textLookingUp?: boolean;
  onLiveText?: (taskId: string, text: TextFieldsText, unsaved: boolean) => void;
  /** Who is in the task's room, for the detail header (#2208). */
  onPresence?: (taskId: string, presence: CollabSessionPresenceSource | null) => void;
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
  footer,
  loadListMembers,
  viewerUsername,
  textCollab,
  textAccessLost = false,
  textLookingUp = false,
  onLiveText,
  onPresence,
}: TasksDetailViewProps) {
  const view = (
    <TasksDetailForm
      task={task}
      L={L}
      taskLists={taskLists}
      allTaskLists={allTaskLists}
      readOnly={readOnly}
      textReadOnly={readOnly || textAccessLost || textLookingUp}
      inRoom={textCollab != null && !textAccessLost}
      onSave={onSave}
      onToggleComplete={onToggleComplete}
      onCreateList={onCreateList}
      onConfirmMove={onConfirmMove}
      footer={footer}
      loadListMembers={loadListMembers}
      viewerUsername={viewerUsername}
    />
  );
  return (
    <>
      {textAccessLost ? (
        <Callout
          severity="warning"
          title={L.liveTextAccessLostTitle}
          message={L.liveTextAccessLost}
        />
      ) : null}
      {textCollab && !textAccessLost ? (
        <TaskTextSession
          key={textCollab.urls.room}
          collab={textCollab}
          task={task}
          L={L}
          onLiveText={onLiveText}
          onPresence={onPresence}
        >
          {view}
        </TaskTextSession>
      ) : (
        view
      )}
    </>
  );
}

/** Why the room holds its save (a blank title, a field over its limit). */
function TaskTextHoldHint() {
  const hold = useTaskTextSession()?.hold;
  if (!hold) return null;
  return (
    <p role="status" className="m-0 text-[0.8rem] font-medium text-destructive">
      {hold}
    </p>
  );
}

function TasksDetailForm({
  task,
  L,
  taskLists,
  allTaskLists,
  readOnly,
  textReadOnly,
  inRoom,
  onSave,
  onToggleComplete,
  onCreateList,
  onConfirmMove,
  footer,
  loadListMembers,
  viewerUsername,
}: Omit<
  TasksDetailViewProps,
  "textCollab" | "textAccessLost" | "textLookingUp" | "onLiveText" | "onPresence"
> & {
  textReadOnly: boolean;
  /** The room saves the title and description: the autosave leaves them out. */
  inRoom: boolean;
}) {
  const [form, setForm] = useTaskEditForm(task, readOnly);
  // In a room, the text waits for the room's first content (as in Notes).
  const textWaiting = useTaskTextSession()?.waiting ?? false;
  const textLocked = textReadOnly || textWaiting;
  const formRef = useRef(form);
  formRef.current = form;
  const pendingRef = useRef<{ taskId: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const inRoomRef = useRef(inRoom);
  inRoomRef.current = inRoom;
  // In a room the title and description are the room's: the autosave leaves
  // both out of its patch.
  const onSaveProp = useRef(onSave);
  onSaveProp.current = onSave;
  const onSaveRef = useRef((taskId: string, value: TasksTaskFormValue) =>
    inRoomRef.current
      ? onSaveProp.current(taskId, value, { skipText: true })
      : onSaveProp.current(taskId, value),
  );

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
  const cancelled = task.workflowStatus === "cancelled";
  const completeLabel = completed ? L.markIncomplete : L.markComplete;
  // As in the list row: the tooltip names what a click does, or why it cannot. The
  // trigger is a span, so the tooltip's `data-state` does not replace the box's.
  const completeControl = (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="tasks-detail-view__complete-hint">
          <Checkbox
            mark
            icon={cancelled ? X : undefined}
            data-status={completed ? (cancelled ? "cancelled" : "completed") : undefined}
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
        textLocked
          ? undefined
          : inRoom
            ? // The room's text, shown in the form; the room saves it.
              (title) => setForm((prev) => ({ ...prev, title }))
            : (title) => update((prev) => ({ ...prev, title }), "later")
      }
      readOnly={textLocked}
      showTags={false}
      tags={[]}
      eyebrow={
        <NotebookSelect
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
            if (onConfirmMove)
              onConfirmMove(list.name, move, taskListName(form.listId, allTaskLists));
            else move();
          }}
          onCreateNotebook={readOnly ? undefined : onCreateList}
        />
      }
    >
      <TaskTextHoldHint />
      <TaskDescriptionField
        value={form.description}
        placeholder={L.detailNotesPlaceholder}
        label={L.descriptionLabel}
        readOnly={textLocked}
        onChange={(description) => update((prev) => ({ ...prev, description }), "later")}
        onBlur={flush}
      />
      <DetailFieldList className="tasks-detail-view__fields" phoneLayout="columns">
        <TasksDetailField icon={<User />} title={L.assigneeLabel}>
          <TasksAssigneesField
            L={L}
            listId={form.listId}
            participants={form.participants}
            disabled={readOnly}
            loadMembers={loadListMembers}
            viewerUsername={viewerUsername}
            onChange={(participants) => update((prev) => ({ ...prev, participants }), "now")}
          />
        </TasksDetailField>
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
      {footer}
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
  /** Who else has the task open (live room only), left of the actions. */
  presence?: ReactNode;
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
  presence,
}: TasksDetailActionBarProps) {
  if (!task) return null;
  return (
    <ActionBar
      onBack={closeMobileDetail}
      backLabel={backLabel}
      rightLeading={presence}
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
