import { createViewPrefsStore, viewPrefsField } from "@/lib/view-prefs-store";

export const TASKS_VIEW_PREFS_STORAGE_KEY = "wgw.ui.tasks.viewPrefs";

export type TasksViewPrefs = {
  hiddenTaskListIds?: string[];
  /** List ids present the last time hidden prefs were written on this device. */
  knownTaskListIds?: string[];
};

export const tasksViewPrefs = createViewPrefsStore<TasksViewPrefs>(TASKS_VIEW_PREFS_STORAGE_KEY, {
  hiddenTaskListIds: viewPrefsField.idList,
  knownTaskListIds: viewPrefsField.idList,
});

export const tasksHiddenLists = tasksViewPrefs.hiddenCollection(
  "hiddenTaskListIds",
  "knownTaskListIds",
);
