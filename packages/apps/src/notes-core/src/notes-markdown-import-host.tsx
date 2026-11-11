import { forwardRef, useImperativeHandle, useRef } from "react";
import type { Note } from "@/lib/models/note";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import type { NotesAPIOperations, NotesNotebookCollection } from "@/notes-core/src/notes-types";
import { MARKDOWN_IMPORT_ACCEPT } from "@/notes-core/src/notes-markdown-import";
import { NotesImportDialog } from "@/notes-core/src/notes-import-dialog";
import { useNotesMarkdownImport } from "@/notes-core/src/use-notes-markdown-import";

export type NotesMarkdownImportHostHandle = {
  /** Open the system file picker. */
  openPicker: () => void;
};

export type NotesMarkdownImportHostProps = {
  operations?: Pick<NotesAPIOperations, "markdownImport">;
  labels: NotesUILabels;
  /** Writable notebooks for the destination picker. */
  notebooks: readonly NotesNotebookCollection[];
  /** Notebook of the current sidebar view, preselected when writable. */
  currentNotebookId?: string | null;
  createNotebook: (name: string) => Promise<NotesNotebookCollection | undefined>;
  /** Import is disabled offline, with the reason in the dialog. */
  offline?: boolean;
  onImported: (notebook: NotesNotebookCollection, notes: Note[]) => void;
};

/** File input + dialog for the Notes Markdown import (#1623). */
export const NotesMarkdownImportHost = forwardRef<
  NotesMarkdownImportHostHandle,
  NotesMarkdownImportHostProps
>(function NotesMarkdownImportHost(
  { operations, labels, notebooks, currentNotebookId, createNotebook, offline = false, onImported },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const importState = useNotesMarkdownImport({
    operations,
    createNotebook,
    labels,
    onImported,
  });
  useImperativeHandle(ref, () => ({ openPicker: () => inputRef.current?.click() }), []);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={MARKDOWN_IMPORT_ACCEPT}
        multiple
        className="hidden"
        aria-label={labels.importMarkdown}
        onChange={(event) => {
          importState.beginImport(event.target.files);
          event.target.value = "";
        }}
      />
      {importState.importFiles ? (
        <NotesImportDialog
          open={importState.importDialogOpen}
          files={importState.importFiles}
          notebooks={notebooks}
          defaultNotebookId={currentNotebookId}
          labels={labels}
          busy={importState.importBusy}
          error={importState.importError}
          unavailableReason={offline ? labels.importOffline : null}
          progress={importState.importProgress}
          result={importState.importResult}
          onClose={importState.closeImportDialog}
          onImport={importState.submitImport}
        />
      ) : null}
    </>
  );
});
