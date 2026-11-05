import type { DriveFile, FileKind } from "@/drive-core/src/drive-models";
import {
  compareListNumber,
  compareListText,
  type ListSort,
  type ListSortDirection,
} from "@/lib/list-sort";

export type DriveListSortKey = "name" | "location" | "modified" | "kind" | "size";

export type DriveListSort = ListSort<DriveListSortKey>;

/** Direction of a column's first click: text A→Z, newest and largest first. */
export const DRIVE_LIST_SORT_COLUMNS: Readonly<Record<DriveListSortKey, ListSortDirection>> = {
  name: "asc",
  location: "asc",
  modified: "desc",
  kind: "asc",
  size: "desc",
};

/** Kind column text; the Kind sort uses it too, so the order matches what people read. */
export const DRIVE_KIND_LABEL: Readonly<Record<FileKind, string>> = {
  folder: "Folder",
  doc: "Document",
  image: "Image",
  video: "Video",
  audio: "Audio",
  archive: "Archive",
  file: "File",
};

export const DRIVE_LIST_DEFAULT_SORT: DriveListSort = { key: "name", direction: "asc" };

export const DRIVE_LIST_SORT_STORAGE_KEY = "wgw.drive.listSort";

function compareText(a: string, b: string, direction: ListSortDirection): number {
  const result = compareListText(a, b);
  return direction === "asc" ? result : -result;
}

function compareBy(a: DriveFile, b: DriveFile, sort: DriveListSort): number {
  switch (sort.key) {
    case "name":
      return compareText(a.title, b.title, sort.direction);
    case "location":
      return compareText(a.location ?? "", b.location ?? "", sort.direction);
    case "kind":
      return compareText(DRIVE_KIND_LABEL[a.kind], DRIVE_KIND_LABEL[b.kind], sort.direction);
    case "modified":
      return compareListNumber(a.modifiedMs, b.modifiedMs, sort.direction);
    case "size":
      return compareListNumber(a.sizeBytes, b.sizeBytes, sort.direction);
  }
}

/**
 * Columns that keep folders above files (Google Drive convention). Kind, size and
 * location sort folders like any other row, so the click visibly reorders the list:
 * folders group under "Folder", and have no size, so they sink below files.
 */
const FOLDERS_FIRST: ReadonlySet<DriveListSortKey> = new Set(["name", "modified"]);

/** Sort a Drive or Docs listing by a column; ties fall back to the name, A→Z. */
export function sortDriveFiles(files: readonly DriveFile[], sort: DriveListSort): DriveFile[] {
  const foldersFirst = FOLDERS_FIRST.has(sort.key);
  return [...files].sort((a, b) => {
    if (foldersFirst) {
      const aFolder = a.kind === "folder";
      const bFolder = b.kind === "folder";
      if (aFolder !== bFolder) return aFolder ? -1 : 1;
    }
    return compareBy(a, b, sort) || compareListText(a.title, b.title);
  });
}
