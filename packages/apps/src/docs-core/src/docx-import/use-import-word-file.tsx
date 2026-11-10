import { useCallback, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { FileUp } from "lucide-react";
import { DocxImportSummaryDialog } from "@/docs-core/src/docx-import/docx-import-dialogs";
import { docxImportLabels as labels } from "@/docs-core/src/docx-import/docx-import-labels";
import {
  useDocxConversionRunner,
  type DocxBatchResult,
} from "@/docs-core/src/docx-import/use-docx-conversion-runner";
import type { DocxImportEntry } from "@/docs-core/src/use-docs-home-create-dialog";
import { useConnectivity } from "@/hooks/use-connectivity";
import type { DropdownMenuItemProps } from "@/menu-dropdown/src/dropdown-menu";

export const IMPORT_WORD_FILE_ITEM_ID = "import-word-file";

type UseImportWordFileArgs = {
  /** False for guests and where the person cannot create Docs. */
  enabled: boolean;
  /** Opens the new Doc; without it the action is not offered. */
  onOpenDocsFile?: (apiPath: string) => void;
  /** Portaled dialog theme class of the host app. */
  dialogSurfaceClassName: string;
};

async function importOne(file: File, docPath: string) {
  const { runImportDocxFile } = await import("@/docs-core/src/docx-import/load-docx-converter");
  return runImportDocxFile(file, docPath);
}

/**
 * Import docx file(s) on Docs home (#1619): a menu item that opens the file
 * picker, and `importFiles` for after the name-and-folder dialog. One file opens
 * its new Doc; several end in one summary. The converter loads on first use.
 */
export function useImportWordFile({
  enabled,
  onOpenDocsFile,
  dialogSurfaceClassName,
}: UseImportWordFileArgs): {
  menuItems: DropdownMenuItemProps[];
  inputRef: RefObject<HTMLInputElement | null>;
  importFiles: ((entries: DocxImportEntry[]) => void) | undefined;
  dialogs: ReactNode;
} {
  const { online } = useConnectivity();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { running, runConversion, runBatch } = useDocxConversionRunner(onOpenDocsFile);
  const [summary, setSummary] = useState<DocxBatchResult[] | null>(null);
  const available = enabled && Boolean(onOpenDocsFile);

  const importFiles = useCallback(
    (entries: DocxImportEntry[]) => {
      const [first] = entries;
      if (!first) return;
      if (entries.length === 1) {
        void runConversion(
          {
            progress: labels.importing(first.file.name),
            failed: labels.importFailed(first.file.name),
          },
          () => importOne(first.file, first.apiPath),
        );
        return;
      }
      void runBatch(
        entries.map(({ file, apiPath }) => ({
          name: file.name,
          task: () => importOne(file, apiPath),
        })),
      ).then((results) => results && setSummary(results));
    },
    [runBatch, runConversion],
  );

  const menuItems = useMemo<DropdownMenuItemProps[]>(() => {
    if (!available) return [];
    return [
      {
        id: IMPORT_WORD_FILE_ITEM_ID,
        label: labels.importWordFile,
        icon: <FileUp aria-hidden />,
        disabled: !online || running,
        description: online ? undefined : labels.offlineReason,
        onClick: () => inputRef.current?.click(),
      },
    ];
  }, [available, online, running]);

  const dialogs = (
    <DocxImportSummaryDialog
      results={summary}
      surfaceClassName={dialogSurfaceClassName}
      onOpen={(docPath) => {
        setSummary(null);
        onOpenDocsFile?.(docPath);
      }}
      onClose={() => setSummary(null)}
    />
  );

  return { menuItems, inputRef, importFiles: available ? importFiles : undefined, dialogs };
}
