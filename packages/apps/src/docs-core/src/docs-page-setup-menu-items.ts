import type { DropdownMenuEntry } from "@/menu-dropdown/src/dropdown-menu";
import type { DocsPageSetupState } from "@/lib/use-docs-page-setup";
import type { TextEditorPageSetup } from "@/lib/page-format";
import {
  DOCS_PAPER_CHOICES,
  docsPaperLabel,
  type DocsPageSetupLabels,
} from "@/lib/docs-page-setup-labels";

export { docsPaperLabel, type DocsPageSetupLabels };

export type DocsPageSetupMenuInput = DocsPageSetupState & {
  labels: DocsPageSetupLabels;
};

/** Accessible name of the page setup button: what it is and what is chosen now. */
export function docsPageSetupButtonLabel(
  pageSetup: TextEditorPageSetup,
  labels: DocsPageSetupLabels,
): string {
  const paper = docsPaperLabel(pageSetup.format, labels);
  if (pageSetup.format === "none") return `${labels.pageSetup}: ${paper}`;
  const orientation =
    pageSetup.orientation === "landscape"
      ? labels.pageOrientationLandscape
      : labels.pageOrientationPortrait;
  return `${labels.pageSetup}: ${paper}, ${orientation}`;
}

/**
 * Menu rows: paper size (`None` shows no pages), then orientation. Each row is a one-tap
 * choice. Orientation has no meaning without paper, so it is off for `None`.
 */
export function docsPageSetupMenuItems({
  pageSetup,
  setPageSetup,
  labels,
}: DocsPageSetupMenuInput): DropdownMenuEntry[] {
  const noPaper = pageSetup.format === "none";
  return [
    ...DOCS_PAPER_CHOICES.map((format) => ({
      id: `format-${format}`,
      label: docsPaperLabel(format, labels),
      checked: pageSetup.format === format,
      onClick: () => setPageSetup({ format }),
    })),
    { type: "separator", id: "after-format" },
    {
      id: "orientation-portrait",
      label: labels.pageOrientationPortrait,
      checked: !noPaper && pageSetup.orientation === "portrait",
      disabled: noPaper,
      onClick: () => setPageSetup({ orientation: "portrait" }),
    },
    {
      id: "orientation-landscape",
      label: labels.pageOrientationLandscape,
      checked: !noPaper && pageSetup.orientation === "landscape",
      disabled: noPaper,
      onClick: () => setPageSetup({ orientation: "landscape" }),
    },
  ];
}
