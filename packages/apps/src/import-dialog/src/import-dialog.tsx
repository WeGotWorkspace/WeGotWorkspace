import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleX } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";
import { ProgressRing } from "@/ui/progress";
import { Separator } from "@/ui/separator";
import { Table, TableBody, TableCell, TableRow } from "@/ui/table";
import "@/import-dialog/src/import-dialog.css";

/** Progress of a running import: 0–100 (or `null` while unknown) and what to say. */
export type ImportDialogProgress = { value: number | null; text: string };

/** One item that did not come in, and why. */
export type ImportSkippedRow = { key: string; name: string; reason: string };

/** What an import did, shown instead of the form. */
export type ImportDialogResult = {
  summary: string;
  /** Nothing came in: a warning icon instead of a check. */
  nothingImported?: boolean;
  skipped?: { heading: string; rows: readonly ImportSkippedRow[] };
  /** Other things worth knowing (dropped tags, items for another app). */
  notes?: { heading: string; items: readonly string[] };
};

type StatusTone = "success" | "warning" | "error";

const STATUS_ICON = { success: CircleCheck, warning: CircleAlert, error: CircleX } as const;

/**
 * The line under the title. It says, in this order of priority: how far the
 * import is, what went wrong, what the import did, or what is about to happen.
 */
function ImportDialogStatus({
  title,
  description,
  progress,
  error,
  result,
}: Pick<ImportDialogProps, "title" | "description" | "progress" | "error" | "result">) {
  if (progress) {
    return (
      <DialogDescription asChild>
        <div className="import-dialog__status" aria-live="polite">
          <ProgressRing value={progress.value} label={title} valueText={progress.text} />
          <span>{progress.text}</span>
        </div>
      </DialogDescription>
    );
  }
  const tone: StatusTone | null = error
    ? "error"
    : result
      ? result.nothingImported
        ? "warning"
        : "success"
      : null;
  const text = error || result?.summary || description;
  if (!text) return null;
  if (!tone) return <DialogDescription>{text}</DialogDescription>;
  const Icon = STATUS_ICON[tone];
  return (
    <DialogDescription asChild>
      <div
        className={cn("import-dialog__status", `import-dialog__status--${tone}`)}
        role={tone === "error" ? "alert" : "status"}
      >
        <Icon className="import-dialog__status-icon" aria-hidden />
        <span>{text}</span>
      </div>
    </DialogDescription>
  );
}

function ImportDialogSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="import-dialog__section" aria-label={heading}>
      <Separator />
      <h3 className="import-dialog__section-heading">{heading}</h3>
      {children}
    </section>
  );
}

/** Skipped items as a table, then other notes as a list. */
export function ImportDialogResultDetails({
  result,
}: {
  result: ImportDialogResult;
}): ReactElement | null {
  const skipped = result.skipped?.rows.length ? result.skipped : null;
  const notes = result.notes?.items.length ? result.notes : null;
  if (!skipped && !notes) return null;
  return (
    <div className="import-dialog__details">
      {skipped ? (
        <ImportDialogSection heading={skipped.heading}>
          <div className="import-dialog__table-scroll">
            <Table className="import-dialog__table">
              <TableBody>
                {skipped.rows.map((row) => (
                  <TableRow key={row.key} className="import-dialog__row">
                    <TableCell className="import-dialog__name" title={row.name}>
                      {row.name}
                    </TableCell>
                    <TableCell className="import-dialog__reason">{row.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </ImportDialogSection>
      ) : null}
      {notes ? (
        <ImportDialogSection heading={notes.heading}>
          <ul className="import-dialog__notes">
            {notes.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </ImportDialogSection>
      ) : null}
    </div>
  );
}

export type ImportDialogProps = {
  open: boolean;
  title: string;
  /** What is about to happen, e.g. "3 files selected". */
  description?: string;
  /** Pass only while importing. */
  progress?: ImportDialogProgress | null;
  error?: string | null;
  /** After an import: summary under the title, details above `children`. */
  result?: ImportDialogResult | null;
  /** Blocks closing while an import runs. */
  busy?: boolean;
  onClose: () => void;
  className?: string;
  onOpenAutoFocus?: ComponentPropsWithoutRef<typeof DialogContent>["onOpenAutoFocus"];
  /** The form, or the result footer. */
  children: ReactNode;
};

/**
 * Frame shared by the import dialogs (Notes, Calendar, Tasks, Contacts): the
 * title with one status line under it, the result details, then `children`.
 */
export function ImportDialog({
  open,
  title,
  description,
  progress = null,
  error = null,
  result = null,
  busy = false,
  onClose,
  className,
  onOpenAutoFocus,
  children,
}: ImportDialogProps): ReactElement {
  const hasStatus = Boolean(progress || error || result || description);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent
        className={cn("import-dialog", className)}
        onOpenAutoFocus={onOpenAutoFocus}
        {...(hasStatus ? {} : { "aria-describedby": undefined })}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <ImportDialogStatus
            title={title}
            description={description}
            progress={progress}
            error={error}
            result={result}
          />
        </DialogHeader>
        {result ? <ImportDialogResultDetails result={result} /> : null}
        {children}
      </DialogContent>
    </Dialog>
  );
}
