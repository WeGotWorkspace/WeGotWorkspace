import { FileCode, FileText, Printer, SquareArrowOutUpRight, UserPlus } from "lucide-react";
import type { DocsHeaderAction, DocsHeaderMenuItem } from "@/docs-core/src/docs-header-actions";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import type { DocsDownloadState } from "@/docs-core/src/use-docs-download";

export type DocsShareMenuActionInput = {
  labels: Pick<
    DocsUILabels,
    "share" | "inviteOthers" | "downloadMarkdown" | "downloadWord" | "print"
  >;
  /** Opens the share dialog. Omitted when this Doc cannot be shared from here. */
  invite?: { onClick: () => void; label?: string };
  /** Omitted when the shell offers no downloads (for example a snapshot preview). */
  download?: DocsDownloadState;
  onPrint: () => void;
  /** No editor yet, or the source view is open: no downloads or Print. */
  contentUnavailable: boolean;
};

/**
 * The Doc header's Share menu, in three groups: Invite others, the downloads, Print.
 * Wide screens show the label next to the icon. PDF (#1617) adds its download after Word.
 */
export function docsShareMenuHeaderAction({
  labels,
  invite,
  download,
  onPrint,
  contentUnavailable,
}: DocsShareMenuActionInput): DocsHeaderAction {
  const contentDisabled = contentUnavailable || Boolean(download?.busy);
  const groups: DocsHeaderMenuItem[][] = [
    invite
      ? [
          {
            id: "invite",
            label: labels.inviteOthers,
            icon: <UserPlus />,
            onClick: invite.onClick,
          },
        ]
      : [],
    download
      ? [
          {
            id: "download-markdown",
            label: labels.downloadMarkdown,
            icon: <FileCode />,
            disabled: contentDisabled,
            onClick: download.downloadMarkdown,
          },
          {
            id: "download-word",
            label: labels.downloadWord,
            icon: <FileText />,
            disabled: contentDisabled,
            onClick: download.downloadWord,
          },
        ]
      : [],
    [
      {
        id: "print",
        label: labels.print,
        icon: <Printer />,
        disabled: contentDisabled,
        onClick: onPrint,
      },
    ],
  ];
  const items = groups
    .filter((group) => group.length > 0)
    .flatMap((group, index) =>
      index === 0 ? group : [{ type: "separator" as const, id: `group-${index}` }, ...group],
    );
  return {
    id: "share",
    label: invite?.label ?? labels.share,
    icon: <SquareArrowOutUpRight />,
    // After the Suggest switch, before the review toggle.
    placement: "end",
    showLabel: true,
    className: "docs-workspace__share-button",
    // Invite others still works in source view; without it the whole menu is unavailable.
    disabled: !invite && contentDisabled,
    items,
  };
}
