import { useCallback, useRef, useState } from "react";
import { docxImportLabels as labels } from "@/docs-core/src/docx-import/docx-import-labels";
import { setPendingDocxImportReport } from "@/docs-core/src/docx-import/docx-import-report-store";
import type { SaveAsMarkdownResult } from "@/docs-core/src/docx-import/save-docx-as-markdown";
import { useAppToast } from "@/hooks/use-app-toast";
import { startDocWithDefaultPageSetup } from "@/lib/docs-page-setup";

type RunTexts = { progress: string; failed: string };

/**
 * Shared by Save as Markdown and Import Word file: one conversion at a time,
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
        const { docPath, report } = await task();
        setPendingDocxImportReport(docPath, report);
        startDocWithDefaultPageSetup(docPath);
        onOpenDocsFile?.(docPath);
      } catch (error) {
        const refusal = (error as { refusal?: keyof typeof labels.refusals } | null)?.refusal;
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

  return { running, runConversion };
}
