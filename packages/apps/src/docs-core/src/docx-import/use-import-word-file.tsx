import { useCallback, useMemo, useRef, type RefObject } from "react";
import { FileUp } from "lucide-react";
import { docxImportLabels as labels } from "@/docs-core/src/docx-import/docx-import-labels";
import { useDocxConversionRunner } from "@/docs-core/src/docx-import/use-docx-conversion-runner";
import { useConnectivity } from "@/hooks/use-connectivity";
import type { DropdownMenuItemProps } from "@/menu-dropdown/src/dropdown-menu";

export const IMPORT_WORD_FILE_ITEM_ID = "import-word-file";

type UseImportWordFileArgs = {
  /** False for guests and where the person cannot create Docs. */
  enabled: boolean;
  /** Opens the new Doc; without it the action is not offered. */
  onOpenDocsFile?: (apiPath: string) => void;
};

/**
 * Import Word file on Docs home (#1619): a menu item that opens the file
 * picker, and `importFile` for after the name-and-folder dialog. The
 * converter loads on first use.
 */
export function useImportWordFile({ enabled, onOpenDocsFile }: UseImportWordFileArgs): {
  menuItems: DropdownMenuItemProps[];
  inputRef: RefObject<HTMLInputElement | null>;
  importFile: ((file: File, docPath: string) => void) | undefined;
} {
  const { online } = useConnectivity();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { running, runConversion } = useDocxConversionRunner(onOpenDocsFile);
  const available = enabled && Boolean(onOpenDocsFile);

  const importFile = useCallback(
    (file: File, docPath: string) =>
      void runConversion(
        { progress: labels.importing(file.name), failed: labels.importFailed(file.name) },
        async () => {
          const { runImportDocxFile } =
            await import("@/docs-core/src/docx-import/load-docx-converter");
          return runImportDocxFile(file, docPath);
        },
      ),
    [runConversion],
  );

  const menuItems = useMemo<DropdownMenuItemProps[]>(() => {
    if (!available) return [];
    return [
      {
        id: IMPORT_WORD_FILE_ITEM_ID,
        label: labels.importWordFile,
        icon: <FileUp aria-hidden />,
        disabled: !online || running,
        description: online ? labels.importGoogleHint : labels.offlineReason,
        onClick: () => inputRef.current?.click(),
      },
    ];
  }, [available, online, running]);

  return { menuItems, inputRef, importFile: available ? importFile : undefined };
}
