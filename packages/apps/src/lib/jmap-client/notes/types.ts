import type { JmapId } from "../core/types.js";

export type JmapNotebook = {
  id: JmapId;
  name: string;
  color?: string | null;
  isDefault?: boolean;
  isSharee?: boolean;
  groupSlug?: string | null;
  scope?: "personal" | "group";
  shareWith?: Record<string, unknown> | null;
  myRights?: { mayWriteAll?: boolean; mayReadItems?: boolean };
  [key: string]: unknown;
};

export type JmapNote = {
  id: JmapId;
  notebookId: JmapId;
  title?: string | null;
  body?: string;
  categories?: string[];
  status?: "FINAL" | "CANCELLED" | null;
  etag?: string;
  starred?: boolean;
  updatedAt?: string;
  contentUpdatedAt?: string;
  [key: string]: unknown;
};
