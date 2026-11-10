import { createElement, useCallback, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import type { Note } from "@/lib/models/note";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import type { NotesAPIOperations, NotesNotebookCollection } from "@/notes-core/src/notes-types";
import { isMarkdownImportFile } from "@/notes-core/src/notes-markdown-import";
import {
  isCleanMarkdownImport,
  runNotesMarkdownImport,
  type NotesMarkdownImportProgress,
  type NotesMarkdownImportResult,
} from "@/notes-core/src/notes-markdown-import-run";
import type { NotesImportDestination } from "@/notes-core/src/notes-import-dialog";

export type UseNotesMarkdownImportOptions = {
  operations?: Pick<NotesAPIOperations, "markdownImport">;
  /** Makes the notebook for a "new notebook" destination; undefined when it failed. */
  createNotebook: (name: string) => Promise<NotesNotebookCollection | undefined>;
  labels: Pick<NotesUILabels, "importedNotes" | "importNoMarkdownFiles" | "importFailed">;
  /** After a batch that imported at least one note: select the notebook, refresh. */
  onImported?: (notebook: NotesNotebookCollection, notes: Note[]) => void;
  /** Tests pass a no-op so network retries do not wait. */
  sleep?: (ms: number) => Promise<void>;
};

export type NotesMarkdownImportState = {
  importFiles: File[] | null;
  importDialogOpen: boolean;
  importBusy: boolean;
  importError: string | null;
  importProgress: NotesMarkdownImportProgress | null;
  importResult: NotesMarkdownImportResult | null;
  beginImport: (fileList: FileList | readonly File[] | null) => void;
  closeImportDialog: () => void;
  submitImport: (files: readonly File[], destination: NotesImportDestination) => void;
};

export function useNotesMarkdownImport({
  operations,
  createNotebook,
  labels: L,
  onImported,
  sleep,
}: UseNotesMarkdownImportOptions): NotesMarkdownImportState {
  const { show, showError } = useAppToast();
  const [importFiles, setImportFiles] = useState<File[] | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<NotesMarkdownImportProgress | null>(null);
  const [importResult, setImportResult] = useState<NotesMarkdownImportResult | null>(null);
  // Same File → same note uid for the dialog's life: pressing Import again
  // after a failure finds the note the first try made (#1623 idempotent retry).
  const uids = useRef(new WeakMap<File, string>());
  // A notebook made by an earlier try of this dialog is reused, not made twice.
  const createdNotebook = useRef<NotesNotebookCollection | null>(null);
  // Set synchronously: `importBusy` is only visible after the next paint.
  const running = useRef(false);

  const beginImport = useCallback(
    (fileList: FileList | readonly File[] | null) => {
      const files = fileList ? Array.from(fileList) : [];
      if (!files.some(isMarkdownImportFile)) {
        showError(L.importNoMarkdownFiles);
        return;
      }
      uids.current = new WeakMap();
      createdNotebook.current = null;
      setImportError(null);
      setImportProgress(null);
      setImportResult(null);
      setImportFiles(files);
    },
    [L.importNoMarkdownFiles, showError],
  );

  const closeImportDialog = useCallback(() => {
    if (importBusy) return;
    setImportFiles(null);
    setImportError(null);
    setImportProgress(null);
    setImportResult(null);
  }, [importBusy]);

  const resolveNotebook = useCallback(
    async (destination: NotesImportDestination): Promise<NotesNotebookCollection> => {
      if (destination.mode === "existing") return destination.notebook;
      const earlier = createdNotebook.current;
      if (earlier && earlier.name === destination.name) return earlier;
      const created = await createNotebook(destination.name);
      if (!created) throw new Error("Notebook was not created.");
      createdNotebook.current = created;
      return created;
    },
    [createNotebook],
  );

  const submitImport = useCallback(
    (files: readonly File[], destination: NotesImportDestination) => {
      const markdownImport = operations?.markdownImport;
      if (!markdownImport) {
        setImportError(L.importFailed);
        return;
      }
      if (running.current) return;
      running.current = true;
      setImportBusy(true);
      setImportError(null);
      setImportResult(null);
      setImportProgress({ done: 0, total: files.length });
      void (async () => {
        try {
          const notebook = await resolveNotebook(destination);
          const result = await runNotesMarkdownImport({
            files,
            notebook,
            operations: markdownImport,
            uidFor: (file) => {
              let uid = uids.current.get(file);
              if (!uid) {
                uid = crypto.randomUUID();
                uids.current.set(file, uid);
              }
              return uid;
            },
            releaseUid: (file) => uids.current.delete(file),
            onProgress: setImportProgress,
            sleep,
          });
          if (result.imported.length > 0) onImported?.(notebook, result.imported);
          if (isCleanMarkdownImport(result)) {
            show(L.importedNotes(result.imported.length), {
              icon: createElement(Upload, { className: "size-4" }),
            });
            setImportFiles(null);
            setImportResult(null);
          } else {
            setImportResult(result);
          }
          setImportProgress(null);
        } catch {
          setImportError(L.importFailed);
        } finally {
          running.current = false;
          setImportBusy(false);
        }
      })();
    },
    [L, onImported, operations, resolveNotebook, show, sleep],
  );

  return {
    importFiles,
    importDialogOpen: importFiles !== null && importFiles.length > 0,
    importBusy,
    importError,
    importProgress,
    importResult,
    beginImport,
    closeImportDialog,
    submitImport,
  };
}
