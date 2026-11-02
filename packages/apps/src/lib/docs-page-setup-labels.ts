import {
  TEXT_EDITOR_PAGE_FORMATS,
  TEXT_EDITOR_PAGE_FORMAT_SPECS,
  type TextEditorPaperChoice,
} from "@/lib/page-format";

/**
 * Page setup words shared by the Docs header menu (`docs-core`) and Docs settings
 * (`settings-core`). Here in `src/lib` so neither app package imports the other.
 */
export const docsPageSetupLabels = {
  pageSetup: "Page setup",
  pagePaperNone: "None",
  pageOrientationPortrait: "Portrait",
  pageOrientationLandscape: "Landscape",
  settingsDescription: "Default paper for new documents",
  settingsPaper: "Paper size",
  settingsOrientation: "Orientation",
  settingsHint:
    "New documents start with this paper. Page setup in a document changes only that document.",
} as const;

export type DocsPageSetupLabels = Pick<
  typeof docsPageSetupLabels,
  "pageSetup" | "pagePaperNone" | "pageOrientationPortrait" | "pageOrientationLandscape"
>;

/** None first, then the paper sizes. */
export const DOCS_PAPER_CHOICES: readonly TextEditorPaperChoice[] = [
  "none",
  ...TEXT_EDITOR_PAGE_FORMATS,
];

/** Short name of the paper choice, as the menu, its button and settings show it. */
export function docsPaperLabel(
  format: TextEditorPaperChoice,
  labels: Pick<DocsPageSetupLabels, "pagePaperNone"> = docsPageSetupLabels,
): string {
  return format === "none" ? labels.pagePaperNone : TEXT_EDITOR_PAGE_FORMAT_SPECS[format].label;
}
