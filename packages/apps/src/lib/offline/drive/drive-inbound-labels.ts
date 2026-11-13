/**
 * Toast copy for the FileNode inbound pull (`useDriveFileNodeInbound`), which
 * Docs and Drive both run. Docs' labels reuse these entries.
 */
export const driveInboundLabels = {
  keptUnsavedDocumentTitle: "A document was removed on the server",
  /** `shownPaths` is the comma-separated list; `count` picks singular or plural. */
  keptUnsavedDocumentMessage: (shownPaths: string, count: number) =>
    count === 1
      ? `Your unsaved copy of ${shownPaths} is still here.`
      : `Your unsaved copies are still here: ${shownPaths}.`,
};
