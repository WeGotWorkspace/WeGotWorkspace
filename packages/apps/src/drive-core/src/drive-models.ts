import type { Note } from "@/lib/models/note";

export const TOP_FOLDERS = ["My Drive", "Shared with me", "Trash"] as const;
export type TopFolder = (typeof TOP_FOLDERS)[number];

export type FileKind = "folder" | "doc" | "image" | "video" | "audio" | "archive" | "file";

export type DriveFile = Note & {
  title: string;
  parent: string;
  kind: FileKind;
  size: string;
  apiPath?: string;
  /** From directory listing `myRights.mayShare` when available. */
  mayShare?: boolean;
  /** Top-level drive location label (e.g. `My Drive`, shared drive name) for cross-drive listings. */
  location?: string;
};

export type ViewKey =
  | { type: "folder"; path: string }
  | { type: "recent" }
  | { type: "starred" }
  | { type: "shared" }
  | { type: "access"; scopePath?: string };

export const DOCS_EDITOR_EXTENSIONS = new Set(["md", "markdown", "txt"]);
