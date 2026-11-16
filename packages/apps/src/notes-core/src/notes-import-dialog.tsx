import { useEffect, useRef, useState, type ReactElement } from "react";
import { Button } from "@/button/src/button";
import { ImportDialog, type ImportDialogResult } from "@/import-dialog/src/import-dialog";
import { DialogFooter } from "@/ui/dialog";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { cn } from "@/lib/utils";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import type { NotesNotebookCollection } from "@/lib/models/notes-types";
import { NotebookSelect } from "@/project-dialog/src/notebook-select";
import type {
  NotesMarkdownImportProgress,
  NotesMarkdownImportResult,
} from "@/notes-core/src/notes-markdown-import-run";
import { NO_AUTOFILL } from "@/ui/no-autofill";

export type NotesImportDestination =
  { mode: "existing"; notebook: NotesNotebookCollection } | { mode: "create"; name: string };

export type NotesImportDialogLabels = Pick<
  NotesUILabels,
  | "importDialogTitle"
  | "importFilesSelected"
  | "importDestinationLegend"
  | "importNewNotebookName"
  | "importNewNotebookDefault"
  | "importSubmit"
  | "importDone"
  | "importRetry"
  | "importProgress"
  | "importedNotes"
  | "importSkippedHeading"
  | "importNotesHeading"
  | "importDroppedTags"
  | "importImagesNotImported"
  | "importSkipReason"
  | "dialogCancel"
  | "addNotebook"
  | "toolbarMoveToNotebook"
>;

export type NotesImportDialogProps = {
  open: boolean;
  files: readonly File[];
  /** Writable notebooks only. */
  notebooks: readonly NotesNotebookCollection[];
  defaultNotebookId?: string | null;
  labels: NotesImportDialogLabels;
  busy?: boolean;
  error?: string | null;
  /** Set while the import cannot run (offline): Import and Retry are disabled and this says why. */
  unavailableReason?: string | null;
  progress?: NotesMarkdownImportProgress | null;
  /** Set after a batch with something to report: the dialog shows it instead of the form. */
  result?: NotesMarkdownImportResult | null;
  onClose: () => void;
  onImport: (files: readonly File[], destination: NotesImportDestination) => void;
  contentClassName?: string;
};

function initialNotebookId(
  notebooks: readonly NotesNotebookCollection[],
  preferred?: string | null,
): string | null {
  if (preferred && notebooks.some((notebook) => notebook.id === preferred)) return preferred;
  return notebooks.find((notebook) => notebook.isDefault)?.id ?? notebooks[0]?.id ?? null;
}

function importResultView(
  result: NotesMarkdownImportResult,
  labels: NotesImportDialogLabels,
): ImportDialogResult {
  const notes = [
    result.droppedTags.length > 0 ? labels.importDroppedTags(result.droppedTags) : null,
    result.imagesNotImported > 0 ? labels.importImagesNotImported(result.imagesNotImported) : null,
  ].filter((note): note is string => note !== null);
  return {
    summary: labels.importedNotes(result.imported.length),
    nothingImported: result.imported.length === 0,
    skipped: {
      heading: labels.importSkippedHeading(result.skipped.length),
      rows: result.skipped.map((item, index) => ({
        key: `${item.fileName}-${index}`,
        name: item.fileName,
        reason: labels.importSkipReason(item.reason, item.status),
      })),
    },
    notes: { heading: labels.importNotesHeading, items: notes },
  };
}

export function NotesImportDialog({
  open,
  files,
  notebooks,
  defaultNotebookId,
  labels,
  busy = false,
  error = null,
  unavailableReason = null,
  progress = null,
  result = null,
  onClose,
  onImport,
  contentClassName,
}: NotesImportDialogProps): ReactElement {
  const [notebookId, setNotebookId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(labels.importNewNotebookDefault);
  const initializedOpen = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const lastDestination = useRef<NotesImportDestination | null>(null);

  useEffect(() => {
    if (!open) {
      initializedOpen.current = false;
      return;
    }
    // Once per open: `notebooks` is a new array on every parent render.
    if (initializedOpen.current) return;
    initializedOpen.current = true;
    const initial = initialNotebookId(notebooks, defaultNotebookId);
    setNotebookId(initial);
    setCreating(initial === null);
    setName(labels.importNewNotebookDefault);
  }, [open, notebooks, defaultNotebookId, labels.importNewNotebookDefault]);

  const selected = notebooks.find((notebook) => notebook.id === notebookId) ?? null;
  const destinationReady = creating ? name.trim() !== "" : selected !== null;
  const canSubmit = destinationReady && files.length > 0 && !busy && !unavailableReason;
  const total = progress?.total ?? files.length;
  const canRetry =
    !!result &&
    !busy &&
    !unavailableReason &&
    lastDestination.current !== null &&
    result.skipped.some((item) => item.reason === "failed");

  return (
    <ImportDialog
      open={open}
      title={labels.importDialogTitle}
      description={labels.importFilesSelected(files.length)}
      progress={
        busy && progress
          ? {
              value: total === 0 ? 0 : (progress.done / total) * 100,
              text: labels.importProgress(progress.done, total),
            }
          : null
      }
      error={error ?? unavailableReason}
      result={result ? importResultView(result, labels) : null}
      busy={busy}
      onClose={onClose}
      className={cn("notes-dialog-surface", contentClassName)}
      onOpenAutoFocus={(event) => {
        // Start on Import, the step the person came for.
        const submit = formRef.current?.querySelector<HTMLButtonElement>('button[type="submit"]');
        if (!submit || submit.disabled) return;
        event.preventDefault();
        submit.focus();
      }}
    >
      {result ? (
        <DialogFooter>
          {canRetry ? (
            <Button
              type="button"
              variant="outline"
              label={labels.importRetry}
              onClick={() => onImport(files, lastDestination.current!)}
            />
          ) : null}
          <Button type="button" variant="primary" label={labels.importDone} onClick={onClose} />
        </DialogFooter>
      ) : (
        <form
          ref={formRef}
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            const destination: NotesImportDestination = creating
              ? { mode: "create", name: name.trim() }
              : { mode: "existing", notebook: selected! };
            lastDestination.current = destination;
            onImport(files, destination);
          }}
        >
          <FieldLabelRow
            layout="inline"
            label={labels.importDestinationLegend}
            htmlFor="notes-import-notebook"
          >
            <NotebookSelect
              id="notes-import-notebook"
              notebooks={[...notebooks]}
              value={
                creating || !selected
                  ? { name: "" }
                  : { id: selected.id, name: selected.name, color: selected.color }
              }
              labels={labels}
              ariaLabel={labels.importDestinationLegend}
              triggerVariant="ghost"
              disabled={busy}
              createSelected={creating}
              onNotebookChange={(notebook) => {
                setNotebookId(notebook.id);
                setCreating(false);
              }}
              onCreateNotebook={() => setCreating(true)}
            />
          </FieldLabelRow>
          {creating ? (
            <FieldLabelRow
              layout="inline"
              fill
              label={labels.importNewNotebookName}
              htmlFor="notes-import-name"
            >
              <Input
                id="notes-import-name"
                {...NO_AUTOFILL}
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </FieldLabelRow>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              label={labels.dialogCancel}
              disabled={busy}
              onClick={onClose}
            />
            <Button type="submit" label={labels.importSubmit} disabled={!canSubmit} />
          </DialogFooter>
        </form>
      )}
    </ImportDialog>
  );
}
