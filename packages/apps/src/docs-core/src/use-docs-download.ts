import { useCallback, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { useAppToast } from "@/hooks/use-app-toast";
import type { TextEditorPageSetup } from "@/lib/page-format";
import { docsLabels, type DocsUILabels } from "@/docs-core/src/docs-labels";

type DownloadLabels = Pick<DocsUILabels, "downloadFailed" | "downloadImagesMissing">;

export type DocsDownloadState = {
  /** A file is being built; the menu stays disabled until it is saved. */
  busy: boolean;
  downloadWord: () => void;
};

/**
 * The Doc header's Download actions: build the file in the browser and report problems.
 * `title` is the Doc's file name or title, for example `Quote.md`.
 */
export function useDocsDownload(
  editor: Editor | null,
  title: string,
  pageSetup?: Pick<TextEditorPageSetup, "format" | "orientation">,
  labels: DownloadLabels = docsLabels,
): DocsDownloadState {
  const toast = useAppToast();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const downloadWord = useCallback(() => {
    if (!editor || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    void (async () => {
      try {
        // The writer (and the `docx` library) load only when someone downloads.
        const { downloadDocAsWord } =
          await import("@/text-editor-core/src/export/docs-download-word");
        const { missingImages } = await downloadDocAsWord({ editor, title, pageSetup });
        if (missingImages > 0) {
          toast.show(labels.downloadImagesMissing(missingImages), { severity: "warning" });
        }
      } catch {
        toast.showError(labels.downloadFailed);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    })();
  }, [editor, title, pageSetup, labels, toast]);

  return { busy, downloadWord };
}
