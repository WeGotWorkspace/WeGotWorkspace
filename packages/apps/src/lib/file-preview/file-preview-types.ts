export type FilePreviewPayload =
  | { kind: "blob-url"; url: string; width?: number; height?: number }
  | { kind: "text"; content: string }
  /** Full raw body for read-only Docs editor preview (detail pane; not used in grid tiles). */
  | { kind: "docs"; content: string }
  | { kind: "unsupported" };
