import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { dropUploadPlaceholderRows } from "@/lib/offline/drive/upload/drive-upload-placeholders";
import {
  driveUploadItemsTable,
  type OfflineDriveUploadItemRow,
} from "@/lib/offline/drive/upload/drive-upload-schema";

type TreeItem = Pick<OfflineDriveUploadItemRow, "id" | "inFolder">;

/** A folder item the server has created: its items target it, nothing is left to start. */
export function isCreatedUploadFolder(
  item: Pick<OfflineDriveUploadItemRow, "kind" | "createdNodeId">,
): boolean {
  return item.kind === "folder" && Boolean(item.createdNodeId);
}

/** Ids of every item below folder item `folderId`, at any depth. */
export function driveUploadSubtreeIds(items: readonly TreeItem[], folderId: string): Set<string> {
  const below = new Set<string>();
  let frontier = [folderId];
  while (frontier.length > 0) {
    const parents = new Set(frontier);
    frontier = items
      .filter((item) => item.inFolder && parents.has(item.inFolder) && !below.has(item.id))
      .map((item) => item.id);
    for (const id of frontier) below.add(id);
  }
  return below;
}

/** Ids of the folder items `item` sits in, nearest first. */
export function driveUploadAncestorIds(items: readonly TreeItem[], item: TreeItem): string[] {
  const byId = new Map(items.map((candidate) => [candidate.id, candidate]));
  const ancestors: string[] = [];
  let parent = item.inFolder ? byId.get(item.inFolder) : undefined;
  while (parent && !ancestors.includes(parent.id)) {
    ancestors.push(parent.id);
    parent = parent.inFolder ? byId.get(parent.inFolder) : undefined;
  }
  return ancestors;
}

/**
 * Inside a transaction over items and entries. The batch is done: the folder
 * rows lose their upload marker and become plain folders, and the folder
 * items go.
 */
export async function finishDriveUploadFolders(
  username: string,
  folders: readonly Pick<OfflineDriveUploadItemRow, "id">[],
): Promise<void> {
  const items = driveUploadItemsTable(offlineDbForAccount(offlineAccountKeyFromUsername(username)));
  for (const folder of folders) {
    await dropUploadPlaceholderRows(username, folder.id);
    await items.delete(folder.id);
  }
}
