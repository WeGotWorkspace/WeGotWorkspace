import type { WgwDriveUploadPlaceholder } from "@/lib/api/wgw/types";
import type { Note } from "@/lib/models/note";

export const TOP_FOLDERS = ["My Drive", "Shared with me", "Trash"] as const;
export type TopFolder = (typeof TOP_FOLDERS)[number];

export type FileKind = "folder" | "doc" | "image" | "video" | "audio" | "archive" | "file";

export type DriveFile = Note & {
  title: string;
  parent: string;
  kind: FileKind;
  size: string;
  /** Last change in epoch ms, for sorting (`date` is display text). */
  modifiedMs?: number;
  /** Size in bytes, for sorting (`size` is display text; unset for folders). */
  sizeBytes?: number;
  apiPath?: string;
  /**
   * FileNode id (`fn-…`) when the listing named it: signed-in JMAP listings and
   * file search results. Docs opens a row by this id without a path lookup (#1976).
   */
  nodeId?: string;
  /** From directory listing `myRights.mayShare` when available. */
  mayShare?: boolean;
  /** From directory listing `myRights.mayManageStructure` (full access) when available. */
  mayManageStructure?: boolean;
  /** True when the item has outgoing share grants (member, guest, or public). */
  isShared?: boolean;
  /** Active public link on this path. */
  hasPublicShare?: boolean;
  /** Active team grants (users or groups) on this path. */
  hasTeamShare?: boolean;
  /** Top-level drive location label (e.g. `My Drive`, shared drive name) for cross-drive listings. */
  location?: string;
  /** Set on a placeholder for a file still in the upload queue. */
  upload?: Pick<WgwDriveUploadPlaceholder, "id" | "status" | "reason">;
};

export type ViewKey =
  /** Every file across the drives (All Files), the Drive home. */
  | { type: "all" }
  | { type: "folder"; path: string }
  | { type: "recent" }
  | { type: "starred" }
  | { type: "shared" }
  /** Every queued, uploading, and failed file across folders (#1502). */
  | { type: "uploads" }
  | { type: "access"; scopePath?: string };

export const DOCS_EDITOR_EXTENSIONS = new Set(["md", "markdown", "txt"]);
