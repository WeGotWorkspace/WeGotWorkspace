import { createViewPrefsStore, viewPrefsField } from "@/lib/view-prefs-store";

export const NOTES_VIEW_PREFS_STORAGE_KEY = "wgw.ui.notes.viewPrefs";

export type NotesViewPrefs = {
  hiddenNotebookIds?: string[];
  /** Notebook ids present the last time hidden prefs were written on this device. */
  knownNotebookIds?: string[];
};

export const notesViewPrefs = createViewPrefsStore<NotesViewPrefs>(NOTES_VIEW_PREFS_STORAGE_KEY, {
  hiddenNotebookIds: viewPrefsField.idList,
  knownNotebookIds: viewPrefsField.idList,
});

export const notesHiddenNotebooks = notesViewPrefs.hiddenCollection(
  "hiddenNotebookIds",
  "knownNotebookIds",
);
