import { useEffect, useRef, useState, type ReactElement } from "react";
import { Button } from "@/button/src/button";
import { Callout } from "@/callout/src/callout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { ProgressRing } from "@/ui/progress";
import { cn } from "@/lib/utils";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import type { NotesNotebookCollection } from "@/notes-core/src/notes-types";
import { NotesNotebookSelect } from "@/notes-core/src/notes-notebook-select";
import type {
  NotesMarkdownImportProgress,
  NotesMarkdownImportResult,
} from "@/notes-core/src/notes-markdown-import-run";
import "@/notes-core/src/notes-import-dialog.css";

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
  | "importProgress"
  | "importedNotes"
  | "importSkippedHeading"
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

function ImportResultView({
  result,
  labels,
}: {
  result: NotesMarkdownImportResult;
  labels: NotesImportDialogLabels;
}): ReactElement {
  return (
    <div className="notes-import-dialog__result" role="status">
      <p className="notes-import-dialog__result-count">
        {labels.importedNotes(result.imported.length)}
      </p>
      {result.skipped.length > 0 ? (
        <section className="notes-import-dialog__skipped" aria-label={labels.importSkippedHeading}>
          <h3 className="notes-import-dialog__skipped-heading">{labels.importSkippedHeading}</h3>
          <ul className="notes-import-dialog__skipped-list">
            {result.skipped.map((item, index) => (
              <li key={`${item.fileName}-${index}`} className="notes-import-dialog__skipped-item">
                <span className="notes-import-dialog__file-name">{item.fileName}</span>
                <span className="notes-import-dialog__reason">
                  {labels.importSkipReason(item.reason, item.status)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {result.droppedTags.length > 0 ? (
        <p className="notes-import-dialog__note">{labels.importDroppedTags(result.droppedTags)}</p>
      ) : null}
      {result.imagesNotImported > 0 ? (
        <p className="notes-import-dialog__note">
          {labels.importImagesNotImported(result.imagesNotImported)}
        </p>
      ) : null}
    </div>
  );
}

export function NotesImportDialog({
  open,
  files,
  notebooks,
  defaultNotebookId,
  labels,
  busy = false,
  error = null,
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
  const canSubmit = destinationReady && files.length > 0 && !busy;
  const total = progress?.total ?? files.length;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent
        className={cn("notes-dialog-surface notes-import-dialog", contentClassName)}
        onOpenAutoFocus={(event) => {
          // Start on Import: focusing the notebook picker pops its tooltip over the field label.
          const submit = formRef.current?.querySelector<HTMLButtonElement>('button[type="submit"]');
          if (!submit || submit.disabled) return;
          event.preventDefault();
          submit.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{labels.importDialogTitle}</DialogTitle>
          <DialogDescription>{labels.importFilesSelected(files.length)}</DialogDescription>
        </DialogHeader>
        {result ? (
          <>
            <ImportResultView result={result} labels={labels} />
            <DialogFooter>
              <Button type="button" variant="primary" label={labels.importDone} onClick={onClose} />
            </DialogFooter>
          </>
        ) : (
          <form
            ref={formRef}
            className="notes-import-dialog__form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canSubmit) return;
              onImport(
                files,
                creating
                  ? { mode: "create", name: name.trim() }
                  : { mode: "existing", notebook: selected! },
              );
            }}
          >
            {error ? <Callout severity="error" title={error} /> : null}
            {busy && progress ? (
              <div className="notes-import-dialog__progress" aria-live="polite">
                <ProgressRing
                  value={total === 0 ? 0 : (progress.done / total) * 100}
                  label={labels.importDialogTitle}
                  valueText={labels.importProgress(progress.done, total)}
                />
                <span>{labels.importProgress(progress.done, total)}</span>
              </div>
            ) : null}
            <FieldLabelRow label={labels.importDestinationLegend}>
              <NotesNotebookSelect
                notebooks={[...notebooks]}
                value={
                  creating || !selected
                    ? { name: "" }
                    : { id: selected.id, name: selected.name, color: selected.color }
                }
                labels={labels}
                ariaLabel={labels.importDestinationLegend}
                size="sm"
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
              <FieldLabelRow label={labels.importNewNotebookName} htmlFor="notes-import-name">
                <Input
                  id="notes-import-name"
                  size="sm"
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
      </DialogContent>
    </Dialog>
  );
}
