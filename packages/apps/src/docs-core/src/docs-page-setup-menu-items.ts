import type { DropdownMenuEntry } from "@/menu-dropdown/src/dropdown-menu";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import type { DocsPageSetupState } from "@/lib/use-docs-page-setup";
import {
  TEXT_EDITOR_PAGE_FORMATS,
  TEXT_EDITOR_PAGE_FORMAT_SPECS,
  type TextEditorPageSetup,
  type TextEditorPaperChoice,
} from "@/lib/page-format";

export type DocsPageSetupLabels = Pick<
  DocsUILabels,
  "pageSetup" | "pagePaperNone" | "pageOrientationPortrait" | "pageOrientationLandscape"
>;

export type DocsPageSetupMenuInput = DocsPageSetupState & {
  labels: DocsPageSetupLabels;
};

const PAPER_CHOICES: readonly TextEditorPaperChoice[] = ["none", ...TEXT_EDITOR_PAGE_FORMATS];

/** Short name of the paper choice, as the menu and its button show it. */
export function docsPaperLabel(format: TextEditorPaperChoice, labels: DocsPageSetupLabels): string {
  return format === "none" ? labels.pagePaperNone : TEXT_EDITOR_PAGE_FORMAT_SPECS[format].label;
}

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
    ...PAPER_CHOICES.map((format) => ({
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
