/**
 * Folder upload (#1620): the tree a pick (`<input webkitdirectory>`) or a
 * drop holds, before anything is queued. Paths are relative to the folder
 * the user is in, with `/` between names ("Photos/2024/beach.jpg").
 *
 * Skipped: names starting with "." (Drive hides them, `.DS_Store` too) and
 * `Thumbs.db` / `desktop.ini`. A skipped folder is not read; it counts once.
 */
export type DriveUploadTreeFile = {
  file: File;
  /** Folder path the file goes in, "" for the folder the user is in. */
  folder: string;
};

export type DriveUploadTree = {
  /** Every folder to create, parents before children, empty folders included. */
  folders: string[];
  files: DriveUploadTreeFile[];
  /** Files and folders left out by the skip rules. */
  skipped: number;
};

const SKIPPED_NAMES = new Set(["thumbs.db", "desktop.ini"]);

export function isSkippedUploadName(name: string): boolean {
  return name.startsWith(".") || SKIPPED_NAMES.has(name.toLowerCase());
}

function addFolderWithParents(folders: Set<string>, path: string) {
  const parts = path.split("/").filter(Boolean);
  for (let depth = 1; depth <= parts.length; depth += 1) {
    folders.add(parts.slice(0, depth).join("/"));
  }
}

/** Parents first: by depth, then by name, so the order is stable. */
function orderFolders(folders: Set<string>): string[] {
  return [...folders].sort((a, b) => {
    const depth = a.split("/").length - b.split("/").length;
    return depth !== 0 ? depth : a.localeCompare(b);
  });
}

/**
 * The tree of a `webkitdirectory` pick, from each file's `webkitRelativePath`.
 * Browsers leave empty folders out of such a pick; a drop keeps them.
 */
export function driveUploadTreeFromFileList(files: Iterable<File>): DriveUploadTree {
  const folders = new Set<string>();
  const kept: DriveUploadTreeFile[] = [];
  // A skipped folder counts once, like in a drop, however many files it holds.
  const skippedPaths = new Set<string>();
  for (const file of files) {
    const parts = (file.webkitRelativePath || file.name).split("/").filter(Boolean);
    const skipAt = parts.findIndex(isSkippedUploadName);
    if (skipAt >= 0) {
      skippedPaths.add(parts.slice(0, skipAt + 1).join("/"));
      continue;
    }
    const folder = parts.slice(0, -1).join("/");
    if (folder) addFolderWithParents(folders, folder);
    kept.push({ file, folder });
  }
  return { folders: orderFolders(folders), files: kept, skipped: skippedPaths.size };
}

/** Every entry of a directory: `readEntries` returns at most about 100 per call. */
async function readAllEntries(directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = directory.createReader();
  const entries: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) return entries;
    entries.push(...batch);
  }
}

function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function isDirectory(entry: FileSystemEntry): entry is FileSystemDirectoryEntry {
  return entry.isDirectory;
}

/**
 * The tree of dropped entries (`DataTransferItem.webkitGetAsEntry()`), files
 * and folders mixed. Files dropped on their own go in the folder the user is in.
 */
export async function driveUploadTreeFromEntries(
  entries: readonly FileSystemEntry[],
): Promise<DriveUploadTree> {
  const folders = new Set<string>();
  const files: DriveUploadTreeFile[] = [];
  let skipped = 0;
  const walk = async (entry: FileSystemEntry, parent: string): Promise<void> => {
    if (isSkippedUploadName(entry.name)) {
      skipped += 1;
      return;
    }
    if (isDirectory(entry)) {
      const path = parent ? `${parent}/${entry.name}` : entry.name;
      folders.add(path);
      for (const child of await readAllEntries(entry)) await walk(child, path);
      return;
    }
    files.push({ file: await fileOf(entry as FileSystemFileEntry), folder: parent });
  };
  for (const entry of entries) await walk(entry, "");
  return { folders: orderFolders(folders), files, skipped };
}

/**
 * The dropped entries when the drop holds at least one folder, else null (a
 * plain file drop keeps the file path). Read synchronously: the items list
 * empties once the drop event returns.
 */
export function droppedFolderEntries(
  items: DataTransferItemList | undefined,
): FileSystemEntry[] | null {
  if (!items) return null;
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  return entries.some((entry) => entry.isDirectory) ? entries : null;
}
