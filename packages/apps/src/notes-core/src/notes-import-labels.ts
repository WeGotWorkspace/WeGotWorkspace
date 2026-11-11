import type { MarkdownImportSkipReason } from "@/notes-core/src/notes-markdown-import";

/** Copy for the Markdown import (#1623). Part of `NotesUILabels`. */
export type NotesImportLabels = {
  importMarkdown: string;
  importNeedsConnection: string;
  importOffline: string;
  importDialogTitle: string;
  importFilesSelected: (count: number) => string;
  importDestinationLegend: string;
  importNewNotebookName: string;
  importNewNotebookDefault: string;
  importSubmit: string;
  importDone: string;
  importRetry: string;
  importProgress: (done: number, total: number) => string;
  importedNotes: (count: number) => string;
  importSkippedHeading: (count: number) => string;
  importNotesHeading: string;
  importDroppedTags: (tags: readonly string[]) => string;
  importImagesNotImported: (count: number) => string;
  importSkipReason: (reason: MarkdownImportSkipReason, status?: number) => string;
  importNoMarkdownFiles: string;
  importFailed: string;
};

const SKIP_REASONS: Record<MarkdownImportSkipReason, string> = {
  unsupportedType: "Not a Markdown or text file",
  tooLarge: "File is too large",
  notUtf8: "Not a UTF-8 text file",
  unreadable: "Could not read this file",
  empty: "File is empty",
  bodyTooLarge: "Note is larger than 2 MB",
  failed: "Could not save this note",
};

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export const defaultNotesImportLabels: NotesImportLabels = {
  importMarkdown: "Import Markdown files",
  importNeedsConnection: "Needs a connection",
  importOffline: "Importing notes needs an internet connection",
  importDialogTitle: "Import Markdown files",
  importFilesSelected: (count) => `${count} ${plural(count, "file", "files")} selected`,
  importDestinationLegend: "Notebook",
  importNewNotebookName: "Notebook name",
  importNewNotebookDefault: "Imported notes",
  importSubmit: "Import",
  importDone: "Done",
  importRetry: "Retry",
  importProgress: (done, total) => `Importing ${Math.min(done + 1, total)} of ${total}…`,
  importedNotes: (count) =>
    count === 0 ? "No notes imported" : `Imported ${count} ${plural(count, "note", "notes")}`,
  importSkippedHeading: (count) => `Skipped files (${count})`,
  importNotesHeading: "Good to know",
  importDroppedTags: (tags) =>
    `${plural(tags.length, "Tag", "Tags")} not added: ${tags.join(", ")}. Tags may only use letters a–z and hyphens.`,
  importImagesNotImported: (count) =>
    `${count} ${plural(count, "image", "images")} not imported. Linked image files stay as text.`,
  importSkipReason: (reason, status) => {
    if (reason !== "failed") return SKIP_REASONS[reason];
    if (status === 401) return "Your session ended. Sign in and try again";
    if (status === 403) return "This notebook is read-only";
    if (status === 404) return "The notebook is no longer available";
    return SKIP_REASONS.failed;
  },
  importNoMarkdownFiles: "Choose Markdown (.md, .markdown) or text (.txt) files.",
  importFailed: "Could not import. Please try again.",
};
