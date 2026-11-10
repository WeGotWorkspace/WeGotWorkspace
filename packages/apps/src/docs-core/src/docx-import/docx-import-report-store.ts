import type { DocxImportReport } from "@/docs-core/src/docx-import/docx-import-report";
import { normalizeApiVirtualPath } from "@/lib/files/api-path";

/**
 * Hands the import report from the list that ran Save as Markdown to the Doc it
 * opens. In memory on purpose: the report shows once, and not after a refresh.
 */
const pending = new Map<string, DocxImportReport>();

export function setPendingDocxImportReport(docPath: string, report: DocxImportReport): void {
  if (report.lines.length === 0) return;
  pending.set(normalizeApiVirtualPath(docPath), report);
}

/** The report for this Doc, left in place so a repeated effect (StrictMode) sees it too. */
export function peekPendingDocxImportReport(docPath: string): DocxImportReport | null {
  return pending.get(normalizeApiVirtualPath(docPath)) ?? null;
}

/** Drops the report once it was shown, so it appears only once. */
export function clearPendingDocxImportReport(docPath: string): void {
  pending.delete(normalizeApiVirtualPath(docPath));
}
