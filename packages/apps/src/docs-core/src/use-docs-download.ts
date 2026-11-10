import { useCallback, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { useAppToast } from "@/hooks/use-app-toast";
import type { TextEditorPageSetup } from "@/lib/page-format";
import { docsLabels, type DocsUILabels } from "@/docs-core/src/docs-labels";
import { triggerBrowserBlobDownload } from "@/lib/offline/docs/docs-offline-download";
import { getAcceptedTextEditorContent } from "@/text-editor-core/src/text-editor-track-changes";
import type { TextEditorContentFormat } from "@/text-editor-core/src/text-editor-content";
import { docsExportFileName } from "@/text-editor-core/src/export/docs-export-file-name";

type DownloadLabels = Pick<DocsUILabels, "downloadFailed" | "downloadImagesMissing">;

export type DocsDownloadState = {
  /** A file is being built; the menu stays disabled until it is saved. */
  busy: boolean;
  /** Only for Markdown Docs; other formats have no Markdown to offer. */
  downloadMarkdown?: () => void;
  downloadWord: () => void;
};

/**
 * The Doc header's downloads: build the file in the browser and report problems.
 * `title` is the Doc's file name or title, for example `Quote.md`.
 */
export function useDocsDownload(
  editor: Editor | null,
  title: string,
  format: TextEditorContentFormat,
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

  // The Markdown the Doc saves: pending suggestions are not part of it yet.
  const downloadMarkdown = useCallback(() => {
    if (!editor) return;
    try {
      const markdown = getAcceptedTextEditorContent(editor, "markdown");
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
      triggerBrowserBlobDownload(blob, docsExportFileName(title, "md"));
    } catch {
      toast.showError(labels.downloadFailed);
    }
  }, [editor, title, labels, toast]);

  return {
    busy,
    downloadMarkdown: format === "markdown" ? downloadMarkdown : undefined,
    downloadWord,
  };
}
