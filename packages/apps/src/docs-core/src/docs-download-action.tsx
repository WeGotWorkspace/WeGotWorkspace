import { Download, FileText } from "lucide-react";
import type { DocsHeaderAction } from "@/docs-core/src/docs-header-actions";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import type { DocsDownloadState } from "@/docs-core/src/use-docs-download";

export type DocsDownloadActionInput = {
  labels: Pick<DocsUILabels, "download" | "downloadWord">;
  download: DocsDownloadState;
  /** No editor yet, or the source view is open (same rule as Print). */
  disabled: boolean;
};

/** The Doc header's Download menu. PDF (#1617) adds its item here. */
export function docsDownloadHeaderAction({
  labels,
  download,
  disabled,
}: DocsDownloadActionInput): DocsHeaderAction {
  return {
    id: "download",
    label: labels.download,
    icon: <Download />,
    disabled: disabled || download.busy,
    items: [
      {
        id: "download-word",
        label: labels.downloadWord,
        icon: <FileText />,
        onClick: download.downloadWord,
      },
    ],
  };
}
