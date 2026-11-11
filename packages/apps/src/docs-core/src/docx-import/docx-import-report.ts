import type { DocxScanCounts } from "@/docs-core/src/docx-import/docx-scan";

/** One line of the import report: what did not come across, and how often. */
export type DocxImportReportLine = {
  id: keyof DocxScanCounts | "failedImages";
  count: number;
  label: string;
};

export type DocxImportReport = {
  /** The Word file the Doc was made from, for the dialog title. */
  sourceName: string;
  lines: DocxImportReportLine[];
};

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/**
 * Plain wording per count, in report order. Tracked changes and notes say what
 * happened to them, because their text is still in the Doc.
 */
const LINE_LABELS: Record<DocxImportReportLine["id"], (n: number) => string> = {
  comments: (n) => plural(n, "comment", "comments"),
  trackedChanges: (n) => `${plural(n, "tracked change", "tracked changes")} (accepted in the text)`,
  headersAndFooters: (n) => plural(n, "header or footer", "headers and footers"),
  footnotes: (n) => `${plural(n, "footnote", "footnotes")} (kept as Notes at the end)`,
  endnotes: (n) => `${plural(n, "endnote", "endnotes")} (kept as Notes at the end)`,
  textBoxes: (n) => plural(n, "text box", "text boxes"),
  textBoxesAsText: (n) =>
    `${plural(n, "text box", "text boxes")} (the text is kept, without the box)`,
  alignment: (n) => plural(n, "aligned paragraph", "aligned paragraphs"),
  pageBreaks: (n) => plural(n, "page break before a paragraph", "page breaks before paragraphs"),
  sections: (n) =>
    plural(n, "extra section with its own page setup", "extra sections with their own page setup"),
  fonts: (n) => plural(n, "font", "fonts"),
  colours: (n) => plural(n, "text colour", "text colours"),
  embeddedObjects: (n) =>
    plural(n, "chart, equation or embedded object", "charts, equations or embedded objects"),
  failedImages: (n) => plural(n, "image that could not be added", "images that could not be added"),
};

export function buildDocxImportReport(
  sourceName: string,
  counts: DocxScanCounts,
  failedImages: number,
): DocxImportReport {
  const all: Record<DocxImportReportLine["id"], number> = { ...counts, failedImages };
  const lines = (Object.keys(LINE_LABELS) as DocxImportReportLine["id"][])
    .filter((id) => all[id] > 0)
    .map((id) => ({ id, count: all[id], label: LINE_LABELS[id](all[id]) }));
  return { sourceName, lines };
}
