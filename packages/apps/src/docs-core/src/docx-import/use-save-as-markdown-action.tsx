import { useCallback, useState, type ReactNode } from "react";
import { FileDown } from "lucide-react";
import { GoogleDocLinkDialog } from "@/docs-core/src/docx-import/docx-import-dialogs";
import { docxImportLabels as labels } from "@/docs-core/src/docx-import/docx-import-labels";
import { saveAsMarkdownSourceKind } from "@/docs-core/src/docx-import/save-as-markdown-source";
import { useDocxConversionRunner } from "@/docs-core/src/docx-import/use-docx-conversion-runner";
import type { DriveFileMenuAction } from "@/drive-core/src/drive-file-actions";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { useConnectivity } from "@/hooks/use-connectivity";

export const SAVE_AS_MARKDOWN_ACTION_ID = "save-as-markdown";

type UseSaveAsMarkdownActionArgs = {
  /** False for guests and where the person cannot create files. */
  enabled: boolean;
  /** Opens the new Doc; without it the action is not offered. */
  onOpenDocsFile?: (apiPath: string) => void;
  /** Signed-in username: files in their own drive may be saved beside without fetched rights. */
  username?: string;
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
  username,
  dialogSurfaceClassName,
}: UseSaveAsMarkdownActionArgs): {
  actionsFor: (file: DriveFile) => DriveFileMenuAction[];
  dialogs: ReactNode;
} {
  const { online } = useConnectivity();
  const [googleLinkName, setGoogleLinkName] = useState<string | null>(null);
  const { running, runConversion } = useDocxConversionRunner(onOpenDocsFile);

  const run = useCallback(
    (apiPath: string, name: string) =>
      runConversion({ progress: labels.saving(name), failed: labels.failed(name) }, async () => {
        const { runSaveDocxAsMarkdown } =
          await import("@/docs-core/src/docx-import/load-docx-converter");
        return runSaveDocxAsMarkdown(apiPath);
      }),
    [runConversion],
  );

  const actionsFor = useCallback(
    (file: DriveFile): DriveFileMenuAction[] => {
      const kind = saveAsMarkdownSourceKind(file, username);
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
    [enabled, onOpenDocsFile, online, run, running, username],
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
