import { useEffect, useState } from "react";
import { Button } from "@/button/src/button";
import { docxImportLabels as labels } from "@/docs-core/src/docx-import/docx-import-labels";
import type { DocxImportReport } from "@/docs-core/src/docx-import/docx-import-report";
import {
  clearPendingDocxImportReport,
  peekPendingDocxImportReport,
} from "@/docs-core/src/docx-import/docx-import-report-store";
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
