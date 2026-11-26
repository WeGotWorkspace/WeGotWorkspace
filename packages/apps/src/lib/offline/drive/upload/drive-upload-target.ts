import { driveJmapSession, resolveFileNodeId } from "@/lib/api/wgw/drive-jmap";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { readMeta, writeMeta } from "@/lib/offline/core/meta-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { normalizeOfflinePath } from "@/lib/offline/core/offline-path";
import { driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import type { DriveUploadTargetFolder } from "@/lib/offline/drive/upload/drive-upload-schema";

/**
 * FileNode ids of folders that have no row of their own in `drive_entries`
 * (the home folder and group roots), remembered while online so files can be
 * queued into them offline.
 */
const FOLDER_NODE_IDS_META_KEY = "drive:folder-node-ids";

/** The folder's id is not known on this device and the server is not reachable. */
export class DriveUploadTargetUnavailableError extends Error {
  constructor(readonly folderPath: string) {
    super("This folder is not available offline yet. Open it once while online.");
    this.name = "DriveUploadTargetUnavailableError";
  }
}

async function readFolderIds(username: string): Promise<Record<string, string>> {
  const raw = await readMeta(username, FOLDER_NODE_IDS_META_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function rememberDriveFolderNodeId(
  username: string,
  folderPath: string,
  nodeId: string | undefined,
): Promise<void> {
  const id = nodeId?.trim();
  if (!id) return;
  const key = normalizeOfflinePath(folderPath);
  const known = await readFolderIds(username);
  if (known[key] === id) return;
  await writeMeta(username, FOLDER_NODE_IDS_META_KEY, JSON.stringify({ ...known, [key]: id }));
}

/**
 * Target folder id for a queued file: the cached row's `nodeId`, then a
 * remembered root id, then the server when online. Always a server id here.
 */
export async function resolveDriveUploadTarget(
  username: string,
  folderPath: string,
): Promise<DriveUploadTargetFolder> {
  const key = normalizeOfflinePath(folderPath);
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const cached = (await driveEntriesTable(db).get(key))?.nodeId?.trim();
  if (cached) return { kind: "server", id: cached };
  const remembered = (await readFolderIds(username))[key];
  if (remembered) return { kind: "server", id: remembered };
  if (!readBrowserOnline()) throw new DriveUploadTargetUnavailableError(folderPath);
  const session = await driveJmapSession();
  const id = await resolveFileNodeId(session, `/${key}`, username);
  await rememberDriveFolderNodeId(username, key, id);
  return { kind: "server", id };
}

/** Current cache path of a folder id, when this device knows it. */
export async function cachedDriveFolderPath(
  username: string,
  folderId: string,
): Promise<string | null> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const row = await driveEntriesTable(db).where("nodeId").equals(folderId).first();
  if (row) return row.id;
  const known = await readFolderIds(username);
  return Object.keys(known).find((path) => known[path] === folderId) ?? null;
}
