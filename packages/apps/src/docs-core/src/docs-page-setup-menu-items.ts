import type { DropdownMenuEntry } from "@/menu-dropdown/src/dropdown-menu";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import type { DocsPageSetupState } from "@/lib/use-docs-page-setup";
import { TEXT_EDITOR_PAGE_FORMATS, TEXT_EDITOR_PAGE_FORMAT_SPECS } from "@/lib/page-format";

export type DocsPageSetupMenuInput = DocsPageSetupState & {
  labels: Pick<
    DocsUILabels,
    | "pageSetup"
    | "pageLayoutPages"
    | "pageLayoutContinuous"
    | "pageOrientationPortrait"
    | "pageOrientationLandscape"
  >;
};

/** Menu rows: pages or continuous, paper size, orientation. Each row is a one-tap choice. */
export function docsPageSetupMenuItems({
  pageSetup,
  setPageSetup,
  labels,
}: DocsPageSetupMenuInput): DropdownMenuEntry[] {
  return [
    {
      id: "layout-pages",
      label: labels.pageLayoutPages,
      checked: pageSetup.layout === "pages",
      onClick: () => setPageSetup({ layout: "pages" }),
    },
    {
      id: "layout-continuous",
      label: labels.pageLayoutContinuous,
      checked: pageSetup.layout === "continuous",
      onClick: () => setPageSetup({ layout: "continuous" }),
    },
    { type: "separator", id: "after-layout" },
    ...TEXT_EDITOR_PAGE_FORMATS.map((format) => ({
      id: `format-${format}`,
      label: TEXT_EDITOR_PAGE_FORMAT_SPECS[format].label,
      checked: pageSetup.format === format,
      onClick: () => setPageSetup({ format }),
    })),
    { type: "separator", id: "after-format" },
    {
      id: "orientation-portrait",
      label: labels.pageOrientationPortrait,
      checked: pageSetup.orientation === "portrait",
      onClick: () => setPageSetup({ orientation: "portrait" }),
    },
    {
      id: "orientation-landscape",
      label: labels.pageOrientationLandscape,
      checked: pageSetup.orientation === "landscape",
      onClick: () => setPageSetup({ orientation: "landscape" }),
    },
  ];
}
