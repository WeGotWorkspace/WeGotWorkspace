import { useCallback, useRef, useState, type ReactNode } from "react";
import { FileDown } from "lucide-react";
import { GoogleDocLinkDialog } from "@/docs-core/src/docx-import/docx-import-dialogs";
import { docxImportLabels as labels } from "@/docs-core/src/docx-import/docx-import-labels";
import { setPendingDocxImportReport } from "@/docs-core/src/docx-import/docx-import-report-store";
import { saveAsMarkdownSourceKind } from "@/docs-core/src/docx-import/save-as-markdown-source";
import type { DriveFileMenuAction } from "@/drive-core/src/drive-file-actions";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { useAppToast } from "@/hooks/use-app-toast";
import { useConnectivity } from "@/hooks/use-connectivity";
import { startDocWithDefaultPageSetup } from "@/lib/docs-page-setup";

export const SAVE_AS_MARKDOWN_ACTION_ID = "save-as-markdown";

type UseSaveAsMarkdownActionArgs = {
  /** False for guests and where the person cannot create files. */
  enabled: boolean;
  /** Opens the new Doc; without it the action is not offered. */
  onOpenDocsFile?: (apiPath: string) => void;
  /** Portaled dialog theme class of the host app. */
  dialogSurfaceClassName: string;
};

/**
 * The Save as Markdown row action for `.docx` and `.gdoc` files (#1983), shared
 * by Drive and the Docs file list. The converter loads on first use.
 */
export function useSaveAsMarkdownAction({
  enabled,
  onOpenDocsFile,
  dialogSurfaceClassName,
}: UseSaveAsMarkdownActionArgs): {
  actionsFor: (file: DriveFile) => DriveFileMenuAction[];
  dialogs: ReactNode;
} {
  const { online } = useConnectivity();
  const { show, dismiss, showError } = useAppToast();
  const [googleLinkName, setGoogleLinkName] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  const run = useCallback(
    async (apiPath: string, name: string) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setRunning(true);
      const toastId = show(labels.saving(name), { duration: Infinity });
      try {
        const { runSaveDocxAsMarkdown } =
          await import("@/docs-core/src/docx-import/load-docx-converter");
        const { docPath, report } = await runSaveDocxAsMarkdown(apiPath);
        setPendingDocxImportReport(docPath, report);
        startDocWithDefaultPageSetup(docPath);
        onOpenDocsFile?.(docPath);
      } catch (error) {
        const refusal = (error as { refusal?: keyof typeof labels.refusals } | null)?.refusal;
        showError(labels.failed(name), {
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

  const actionsFor = useCallback(
    (file: DriveFile): DriveFileMenuAction[] => {
      const kind = saveAsMarkdownSourceKind(file);
      if (!enabled || !onOpenDocsFile || !kind || !file.apiPath || file.upload) return [];
      const base = {
        id: SAVE_AS_MARKDOWN_ACTION_ID,
        label: labels.saveAsMarkdown,
        icon: <FileDown className="size-4" aria-hidden />,
      };
      if (!online) {
        return [{ ...base, disabled: true, description: labels.offlineReason }];
      }
      const apiPath = file.apiPath;
      return [
        {
          ...base,
          disabled: running,
          onClick: () =>
            kind === "gdoc" ? setGoogleLinkName(file.title) : void run(apiPath, file.title),
        },
      ];
    },
    [enabled, onOpenDocsFile, online, run, running],
  );

  const dialogs = (
    <GoogleDocLinkDialog
      fileName={googleLinkName}
      surfaceClassName={dialogSurfaceClassName}
      onClose={() => setGoogleLinkName(null)}
    />
  );
  return { actionsFor, dialogs };
}
