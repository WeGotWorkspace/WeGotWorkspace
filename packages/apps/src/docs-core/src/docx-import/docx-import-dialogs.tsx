import { useEffect, useState } from "react";
import { Button } from "@/button/src/button";
import { docxImportLabels as labels } from "@/docs-core/src/docx-import/docx-import-labels";
import type { DocxImportReport } from "@/docs-core/src/docx-import/docx-import-report";
import {
  clearPendingDocxImportReport,
  peekPendingDocxImportReport,
} from "@/docs-core/src/docx-import/docx-import-report-store";
import type { DocxBatchResult } from "@/docs-core/src/docx-import/use-docx-conversion-runner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import "@/docs-core/src/docx-import/docx-import-dialogs.css";

/** What a Save as Markdown left out, shown once when the new Doc opens. */
export function DocxImportReportDialog({
  report,
  surfaceClassName,
  onClose,
}: {
  report: DocxImportReport | null;
  /** Portaled dialog theme class of the host app. */
  surfaceClassName: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={report !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={`${surfaceClassName} sm:max-w-md`}>
        <DialogHeader>
          <DialogTitle>{labels.reportTitle}</DialogTitle>
          <DialogDescription>
            {report ? labels.reportDescription(report.sourceName) : null}
          </DialogDescription>
        </DialogHeader>
        <ul className="docx-import-report__list">
          {report?.lines.map((line) => (
            <li key={line.id} className="docx-import-report__line">
              <span className="docx-import-report__count">{line.count}</span> {line.label}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="primary" onClick={onClose} label={labels.close} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Shows the pending import report for the Doc at `docPath`, once. */
export function DocxImportReportForDoc({
  docPath,
  surfaceClassName,
}: {
  docPath: string;
  surfaceClassName: string;
}) {
  const [report, setReport] = useState<DocxImportReport | null>(null);
  useEffect(() => {
    setReport(docPath ? peekPendingDocxImportReport(docPath) : null);
  }, [docPath]);
  return (
    <DocxImportReportDialog
      report={report}
      surfaceClassName={surfaceClassName}
      onClose={() => {
        clearPendingDocxImportReport(docPath);
        setReport(null);
      }}
    />
  );
}

/** A `.gdoc` is a link to Google Docs: say how to bring the document in instead. */
export function GoogleDocLinkDialog({
  fileName,
  surfaceClassName,
  onClose,
}: {
  fileName: string | null;
  surfaceClassName: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={fileName !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={`${surfaceClassName} sm:max-w-md`}>
        <DialogHeader>
          <DialogTitle>{labels.googleLinkTitle}</DialogTitle>
          <DialogDescription>
            {fileName ? labels.googleLinkDescription(fileName) : null}
          </DialogDescription>
        </DialogHeader>
        <p className="docx-import-report__steps">{labels.googleLinkSteps}</p>
        <DialogFooter>
          <Button variant="primary" onClick={onClose} label={labels.close} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** After importing several Word files: one row per file; a row with a Doc opens it. */
export function DocxImportSummaryDialog({
  results,
  surfaceClassName,
  onOpen,
  onClose,
}: {
  results: readonly DocxBatchResult[] | null;
  surfaceClassName: string;
  onOpen: (docPath: string) => void;
  onClose: () => void;
}) {
  const imported = results?.filter((result) => result.docPath !== null).length ?? 0;
  return (
    <Dialog open={results !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={`${surfaceClassName} sm:max-w-md`}>
        <DialogHeader>
          <DialogTitle>{labels.summaryTitle(imported, results?.length ?? 0)}</DialogTitle>
          <DialogDescription>{labels.summaryDescription}</DialogDescription>
        </DialogHeader>
        <ul className="docx-import-summary__list">
          {results?.map((result, index) => (
            <li key={`${index}-${result.name}`} className="docx-import-summary__row">
              {result.docPath !== null ? (
                <button
                  type="button"
                  className="docx-import-summary__name docx-import-summary__name--link"
                  onClick={() => onOpen(result.docPath)}
                >
                  {result.name}
                </button>
              ) : (
                <span className="docx-import-summary__name">{result.name}</span>
              )}
              <span
                className={
                  result.docPath === null
                    ? "docx-import-summary__status docx-import-summary__status--failed"
                    : "docx-import-summary__status"
                }
              >
                {result.docPath === null
                  ? result.reason
                  : result.complete
                    ? labels.summaryComplete
                    : labels.summaryPartial}
              </span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="primary" onClick={onClose} label={labels.close} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
