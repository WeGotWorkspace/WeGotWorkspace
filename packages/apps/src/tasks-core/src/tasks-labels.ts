import type { TaskWriteRefusal } from "@/lib/offline/tasks/tasks-refused-write";
import { defaultOwnerScopeLabels } from "@/ui/owner-scope-labels";

export type TasksUILabels = {
  appName: string;
  sidebarStatus: string;
  sidebarPriority: string;
  sidebarInbox: string;
  sidebarProjects: string;
  sidebarSharedWithMe: string;
  stateAll: string;
  newTaskMenu: string;
  addList: string;
  editList: string;
  viewOnlyListBadge: string;
  shareListSectionTitle: string;
  shareListSectionHint: string;
  shareListAddPlaceholder: string;
  shareListSearchEmpty: string;
  shareListOffline: string;
  shareListFailed: string;
  removeListShareTitle: string;
  removeListShareConfirm: string;
  removeSharedList: string;
  removeSharedListConfirmTitle: string;
  removeSharedListConfirmDescription: string;
  deleteList: string;
  deleteListConfirmTitle: string;
  deleteListConfirmDescription: string;
  toastListShareRemoved: string;
  toastListDeleted: string;
  stateToday: string;
  stateUpcoming: string;
  stateOverdue: string;
  stateNeedsAction: string;
  stateInProcess: string;
  stateCompleted: string;
  stateCancelled: string;
  newTask: string;
  listTasks: (count: number) => string;
  listSelected: (count: number) => string;
  refreshList: string;
  emptyDetail: string;
  selectTask: string;
  fallbackViewTitle: string;
  statusNeedsAction: string;
  statusInProcess: string;
  statusCompleted: string;
  statusCancelled: string;
  priorityNone: string;
  priorityHigh: string;
  priorityMedium: string;
  priorityLow: string;
  addTaskPriority: string;
  addTaskDue: string;
  dueLabel: string;
  dueToday: string;
  dueYesterday: string;
  dueTomorrow: string;
  noDue: string;
  descriptionLabel: string;
  remindMe: string;
  noReminders: string;
  remindersCount: (count: number) => string;
  remindingBefore: (durations: string) => string;
  remindingAfter: (durations: string) => string;
  remindingAfterClause: (durations: string) => string;
  dueAddTime: string;
  dueDateOnly: string;
  dueTimeLabel: string;
  remindAtTimeOfTask: string;
  kanbanToggle: string;
  listView: string;
  showCompletedTasks: string;
  hideCompletedTasks: string;
  addTaskName: string;
  addTaskNamePlaceholder: string;
  addTaskDescriptionPlaceholder: string;
  addTaskList: string;
  newProject: string;
  projectNameLabel: string;
  projectColorLabel: string;
  projectScopeLabel: string;
  projectScopePersonal: (ownerLabel: string) => string;
  projectScopeGroup: (name: string) => string;
  projectScopeReadOnlyLabel: string;
  changeListOwnerConfirmTitle: string;
  changeListOwnerConfirmToGroup: (groupName: string) => string;
  changeListOwnerConfirmToPersonal: string;
  changeListOwnerConfirm: string;
  createProjectButton: string;
  saveProjectButton: string;
  toastProjectCreated: string;
  toastProjectRenamed: (name: string) => string;
  toastProjectSaveFailed: string;
  addTaskStatus: string;
  addTaskButton: string;
  editTask: string;
  editTaskTitle: string;
  editTaskPrompt: string;
  saveTaskButton: string;
  markComplete: string;
  markIncomplete: string;
  taskActions: string;
  delete: string;
  deleteConfirmTitle: string;
  deleteConfirmBody: string;
  cancel: string;
  toastSaved: string;
  toastDeleted: string;
  toastTaskCompleted: string;
  toastTaskReopened: string;
  toastTaskAdded: string;
  toastTaskUpdated: string;
  toastTaskMoved: (count: number, listName: string) => string;
  toastCompleteUndone: string;
  toastDeleteUndone: string;
  toastMoveUndone: string;
  toastListUpdated: string;
  toastListRefreshFailed: string;
  createTaskTitle: string;
  untitledTask: string;
  subtasksLabel: string;
  tasksDisabledTitle: string;
  tasksDisabledMessage: string;
  pendingSync: string;
  conflictTitle: string;
  conflictDescription: (title: string) => string;
  conflictRemaining: (count: number) => string;
  conflictKeepMine: string;
  conflictUseServer: string;
  conflictDescriptionFieldMerge: (title: string) => string;
  conflictFieldLocal: string;
  conflictFieldServer: string;
  conflictApplyMerge: string;
  /** A queued write the server refused for good (#1825). */
  taskWriteRefused: (title: string, reason: TaskWriteRefusal) => string;
  /** The dialog that asks where refused offline tasks go (#1825). */
  rescueTitle: (count: number) => string;
  rescueDescription: string;
  rescueFrom: (listName: string, reason: "gone" | "readOnly") => string;
  rescueAsNewTask: string;
  rescueToExisting: string;
  rescueToNew: string;
  rescueNoWritableList: string;
  rescueListLabel: string;
  rescueNewListLabel: string;
  rescueNewListName: (listName: string) => string;
  rescueMove: (count: number) => string;
  rescueDiscard: (count: number) => string;
  rescueLater: string;
  rescueEntry: (count: number) => string;
  rescueMoved: (count: number, listName: string) => string;
  rescueDiscarded: (count: number) => string;
  rescueFailed: string;
  rescueOpenElsewhere: string;
};

export const defaultTasksLabels: TasksUILabels = {
  appName: "Tasks",
  sidebarStatus: "Status",
  sidebarPriority: "Priority",
  sidebarInbox: "Inbox",
  sidebarProjects: "My lists",
  sidebarSharedWithMe: "Shared with me",
  stateAll: "All Tasks",
  newTaskMenu: "More create options",
  addList: "Create list",
  editList: "Edit list",
  viewOnlyListBadge: "View only",
  shareListSectionTitle: "Team access",
  shareListSectionHint: "Grant read or read-and-write access to people or groups.",
  shareListAddPlaceholder: "Add people or groups…",
  shareListSearchEmpty: "No people or groups found",
  shareListOffline: "Sharing changes require a connection.",
  shareListFailed: "Could not update sharing.",
  removeListShareTitle: "Remove access?",
  removeListShareConfirm: "This person or group will lose access to this list. Continue?",
  removeSharedList: "Remove list",
  removeSharedListConfirmTitle: "Remove this list?",
  removeSharedListConfirmDescription:
    "It disappears from your sidebar. The owner’s list is unchanged, so it can be added again later.",
  deleteList: "Delete list",
  deleteListConfirmTitle: "Delete list?",
  deleteListConfirmDescription:
    "Tasks on this list will be permanently deleted. This cannot be undone.",
  toastListShareRemoved: "List removed",
  toastListDeleted: "List deleted",
  stateToday: "Today",
  stateUpcoming: "Upcoming",
  stateOverdue: "Overdue",
  stateNeedsAction: "Needs action",
  stateInProcess: "In progress",
  stateCompleted: "Completed",
  stateCancelled: "Cancelled",
  newTask: "New task",
  listTasks: (count) => (count === 1 ? "1 task" : `${count} tasks`),
  listSelected: (count) => (count === 1 ? "1 selected" : `${count} selected`),
  refreshList: "Refresh",
  emptyDetail: "Select a task or create a new one.",
  selectTask: "Select a task",
  fallbackViewTitle: "Tasks",
  statusNeedsAction: "Needs action",
  statusInProcess: "In progress",
  statusCompleted: "Completed",
  statusCancelled: "Cancelled",
  priorityNone: "None",
  priorityHigh: "High",
  priorityMedium: "Medium",
  priorityLow: "Low",
  addTaskPriority: "Priority",
  addTaskDue: "Due date",
  dueLabel: "Due",
  dueToday: "Today",
  dueYesterday: "Yesterday",
  dueTomorrow: "Tomorrow",
  noDue: "No due date",
  descriptionLabel: "Notes",
  remindMe: "Remind me",
  noReminders: "No reminders",
  remindersCount: (count) => (count === 1 ? "1 reminder" : `${count} reminders`),
  remindingBefore: (durations) => `Reminding ${durations} before`,
  remindingAfter: (durations) => `Reminding ${durations} after`,
  remindingAfterClause: (durations) => `${durations} after`,
  dueAddTime: "Add time",
  dueDateOnly: "Date only",
  dueTimeLabel: "Time",
  remindAtTimeOfTask: "At time of task",
  kanbanToggle: "Kanban",
  listView: "List",
  showCompletedTasks: "Show completed",
  hideCompletedTasks: "Hide completed",
  addTaskName: "Task name",
  addTaskNamePlaceholder: "Task name",
  addTaskDescriptionPlaceholder: "Description",
  addTaskList: "List",
  newProject: "Create list",
  projectNameLabel: "List name",
  projectColorLabel: "Color",
  projectScopeLabel: defaultOwnerScopeLabels.label,
  projectScopePersonal: defaultOwnerScopeLabels.personal,
  projectScopeGroup: defaultOwnerScopeLabels.group,
  projectScopeReadOnlyLabel: defaultOwnerScopeLabels.readOnlyLabel,
  changeListOwnerConfirmTitle: "Change owner?",
  changeListOwnerConfirmToGroup: (groupName) =>
    `This list will move to ${groupName}. Tasks and existing shares stay. People who are not in that group lose access unless they have a share.`,
  changeListOwnerConfirmToPersonal:
    "This list will move to your personal lists. Tasks and existing shares stay. Other group members lose access unless they have a share.",
  changeListOwnerConfirm: "Change owner",
  createProjectButton: "Create",
  saveProjectButton: "Save",
  toastProjectCreated: "List created",
  toastProjectRenamed: (name) => `Renamed to ${name}`,
  toastProjectSaveFailed: "Could not save list",
  addTaskStatus: "Status",
  addTaskButton: "Add task",
  editTask: "Edit",
  editTaskTitle: "Edit task",
  editTaskPrompt: "Task title",
  saveTaskButton: "Save",
  markComplete: "Mark complete",
  markIncomplete: "Mark incomplete",
  taskActions: "Task actions",
  delete: "Delete",
  deleteConfirmTitle: "Delete task?",
  deleteConfirmBody: "This task will be removed from your list.",
  cancel: "Cancel",
  toastSaved: "Saved",
  toastDeleted: "Task deleted",
  toastTaskCompleted: "Task completed",
  toastTaskReopened: "Marked incomplete",
  toastTaskAdded: "Task added",
  toastTaskUpdated: "Task updated",
  toastTaskMoved: (count, listName) =>
    count === 1 ? `Moved to ${listName}` : `Moved ${count} tasks to ${listName}`,
  toastCompleteUndone: "Completion undone.",
  toastDeleteUndone: "Deletion undone.",
  toastMoveUndone: "Move undone.",
  toastListUpdated: "List updated",
  toastListRefreshFailed: "Could not refresh tasks. Please try again.",
  createTaskTitle: "New task",
  untitledTask: "Untitled task",
  subtasksLabel: "Subtasks",
  tasksDisabledTitle: "Tasks unavailable",
  tasksDisabledMessage: "Tasks are disabled for this workspace.",
  pendingSync: "Pending sync",
  conflictTitle: "Sync conflict",
  conflictDescription: (title) =>
    `Your offline edits to “${title}” conflict with a newer version on the server.`,
  conflictRemaining: (count) => `${count} more task${count === 1 ? "" : "s"} to review`,
  conflictKeepMine: "Keep mine",
  conflictUseServer: "Use server version",
  conflictDescriptionFieldMerge: (title) =>
    `Choose which values to keep for “${title}”. Unselected fields use the server version.`,
  conflictFieldLocal: "Your edits",
  conflictFieldServer: "Server version",
  conflictApplyMerge: "Apply merged changes",
  taskWriteRefused: (title, reason) =>
    ({
      gone: `“${title}” was deleted, or you no longer have access to its list. Your offline changes to it were not kept.`,
      readOnly: `You can only view the list with “${title}” now. Your offline changes to it were not saved.`,
      notSaved: `Your offline changes to “${title}” could not be saved. It shows the server version again.`,
    })[reason],
  rescueTitle: (count) => (count === 1 ? "A task needs a list" : `${count} tasks need a list`),
  rescueDescription:
    "These could not be saved where they were: the task or its list was deleted, is no longer shared with you, or is view-only now. Choose where to keep them.",
  rescueFrom: (listName, reason) => {
    const list = listName ? `“${listName}”` : "a list";
    return reason === "readOnly"
      ? `From ${list}: view-only now`
      : `From ${list}: deleted, or no longer shared with you`;
  },
  rescueAsNewTask: "Your offline changes, kept as a new task",
  rescueToExisting: "An existing list",
  rescueToNew: "A new list",
  rescueNoWritableList: "There is no list you can add tasks to.",
  rescueListLabel: "List",
  rescueNewListLabel: "Name of the new list",
  rescueNewListName: (listName) => (listName ? `Rescued from ${listName}` : "Rescued tasks"),
  rescueMove: (count) => (count === 1 ? "Move task" : `Move ${count} tasks`),
  rescueDiscard: (count) => (count === 1 ? "Discard task" : `Discard ${count} tasks`),
  rescueLater: "Decide later",
  rescueEntry: (count) => (count === 1 ? "1 task needs a list" : `${count} tasks need a list`),
  rescueMoved: (count, listName) =>
    count === 1 ? `Moved 1 task to “${listName}”` : `Moved ${count} tasks to “${listName}”`,
  rescueDiscarded: (count) => (count === 1 ? "Discarded 1 task" : `Discarded ${count} tasks`),
  rescueFailed: "Some tasks could not be moved. They are still waiting for a list.",
  rescueOpenElsewhere:
    "These tasks are open in another Tasks tab. Choose where to keep them there.",
};

export function mergeTasksLabels(overrides?: Partial<TasksUILabels>): TasksUILabels {
  return { ...defaultTasksLabels, ...overrides };
}
