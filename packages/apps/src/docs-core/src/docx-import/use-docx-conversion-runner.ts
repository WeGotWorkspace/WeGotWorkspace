import { useCallback, useRef, useState } from "react";
import { docxImportLabels as labels } from "@/docs-core/src/docx-import/docx-import-labels";
import { setPendingDocxImportReport } from "@/docs-core/src/docx-import/docx-import-report-store";
import type { SaveAsMarkdownResult } from "@/docs-core/src/docx-import/save-docx-as-markdown";
import { useAppToast } from "@/hooks/use-app-toast";
import { startDocWithDefaultPageSetup } from "@/lib/docs-page-setup";

type RunTexts = { progress: string; failed: string };

/** One file of a batch import: its name, and the Doc made from it or why not. */
export type DocxBatchResult =
  | { name: string; docPath: string; complete: boolean }
  | { name: string; docPath: null; reason: string };

export type DocxBatchJob = { name: string; task: () => Promise<SaveAsMarkdownResult> };

type Refusal = keyof typeof labels.refusals;
const refusalOf = (error: unknown) => (error as { refusal?: Refusal } | null)?.refusal;

/** The Doc is saved: hand it its report and the default page setup before it opens. */
function prepareConvertedDoc({ docPath, report }: SaveAsMarkdownResult): void {
  setPendingDocxImportReport(docPath, report);
  try {
    startDocWithDefaultPageSetup(docPath);
  } catch {
    // The Doc is saved: it opens with the page setup it has.
  }
}

/**
 * Shared by Save as Markdown and Import docx file(s): one conversion at a time,
 * a progress toast, the report hand-over, then the new Doc opens. A refusal
 * explains itself; nothing is opened.
 */
export function useDocxConversionRunner(onOpenDocsFile: ((apiPath: string) => void) | undefined) {
  const { show, dismiss, showError } = useAppToast();
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  const runConversion = useCallback(
    async (texts: RunTexts, task: () => Promise<SaveAsMarkdownResult>) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setRunning(true);
      const toastId = show(texts.progress, { duration: Infinity });
      try {
        const result = await task();
        prepareConvertedDoc(result);
        onOpenDocsFile?.(result.docPath);
      } catch (error) {
        const refusal = refusalOf(error);
        showError(texts.failed, {
          description: refusal ? labels.refusals[refusal] : undefined,
          duration: 10_000,
        });
      } finally {
        dismiss(toastId);
        runningRef.current = false;
        setRunning(false);
      }
    },
    [dismiss, onOpenDocsFile, show, showError],
  );

  /** Several files, one after the other; nothing opens, the results come back for a summary. */
  const runBatch = useCallback(
    async (jobs: readonly DocxBatchJob[]): Promise<DocxBatchResult[] | null> => {
      if (runningRef.current) return null;
      runningRef.current = true;
      setRunning(true);
      const results: DocxBatchResult[] = [];
      let toastId: string | number | null = null;
      try {
        for (const [index, job] of jobs.entries()) {
          if (toastId !== null) dismiss(toastId);
          toastId = show(labels.importingMany(index, jobs.length), { duration: Infinity });
          try {
            const result = await job.task();
            prepareConvertedDoc(result);
            results.push({
              name: job.name,
              docPath: result.docPath,
              complete: result.report.lines.length === 0,
            });
          } catch (error) {
            const refusal = refusalOf(error);
            results.push({
              name: job.name,
              docPath: null,
              reason: refusal ? labels.refusals[refusal] : labels.summaryFailed,
            });
          }
        }
        return results;
      } finally {
        if (toastId !== null) dismiss(toastId);
        runningRef.current = false;
        setRunning(false);
      }
    },
    [dismiss, show],
  );

  return { running, runConversion, runBatch };
}
