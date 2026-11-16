/**
 * Labels of the shared note body (#2116): its default title and the "changed
 * outside the app" prompt. Notes, Calendar, Contacts and Tasks all get these;
 * Notes' own labels reuse them.
 */
export type NoteBodyLabels = {
  titlePlaceholder: string;
  externalWriteTitle: string;
  externalWriteDescription: (title: string) => string;
  externalWriteKeepMine: string;
  externalWriteUseOutside: string;
};

export const defaultNoteBodyLabels: NoteBodyLabels = {
  titlePlaceholder: "Title",
  externalWriteTitle: "Changed outside the app",
  externalWriteDescription: (title) =>
    `"${title}" was changed outside the app, and you also have unsaved changes. Nothing has been overwritten.`,
  externalWriteKeepMine: "Keep my edits",
  externalWriteUseOutside: "Use the outside version",
};
