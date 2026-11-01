import type { DriveJmapSession } from "@/lib/api/wgw/drive-jmap";
import {
  DriveUploadForbiddenError,
  DriveUploadTargetMissingError,
} from "@/lib/api/wgw/drive-upload-errors";
import type { JmapFileNode } from "@/lib/jmap-client";

/** A trash folder right under a drive root (`.Trash`, or the legacy `Trash`). */
const TRASH_FOLDER_NAMES = new Set([".Trash", "Trash"]);
/** Deeper than any real folder tree; stops a cycle in a broken index. */
const MAX_ANCESTORS = 64;
/** How long a checked chain of ancestors is trusted while the folder keeps its parent. */
const ANCESTORS_CHECK_TTL_MS = 30_000;

/** `${folderId}\n${parentId}` → when its ancestors were last found outside any trash. */
const checkedAncestors = new Map<string, number>();

export function resetDriveUploadTargetChecksForTests(): void {
  checkedAncestors.clear();
}

async function getNode(
  session: DriveJmapSession,
  id: string,
  signal?: AbortSignal,
): Promise<JmapFileNode | null> {
  const got = await session.fileNodes.getFileNodes(session.accountId, [id], { signal });
  return got.list.find((node) => node.id === id) ?? null;
}

/**
 * Walks up from `folder` until a drive root, or until a parent this account
 * cannot see (a folder shared with it). True when one of them is a trash: a
 * `.Trash` folder right under a drive root.
 */
async function isInTrash(
  session: DriveJmapSession,
  folder: JmapFileNode,
  signal?: AbortSignal,
): Promise<boolean> {
  let current = folder;
  for (let depth = 0; depth < MAX_ANCESTORS && current.parentId; depth += 1) {
    const parent = await getNode(session, current.parentId, signal);
    if (!parent) return false;
    if (!parent.parentId && TRASH_FOLDER_NAMES.has(current.name)) return true;
    current = parent;
  }
  return false;
}

/**
 * Before any byte is sent: the queued file's target folder, looked up by id,
 * so a folder that was renamed or moved meanwhile is still the target. It
 * fails as `target_missing` when the folder is gone or sits in a trash, and
 * as `forbidden` when the account may no longer add files to it. The walk up
 * the ancestors is skipped for a folder checked in the last 30 seconds that
 * still has the same parent, so a batch costs one lookup per file.
 */
export async function assertDriveUploadTarget(
  session: DriveJmapSession,
  folderId: string,
  signal?: AbortSignal,
): Promise<void> {
  const folder = await getNode(session, folderId, signal);
  if (!folder || folder.nodeType !== "directory") {
    throw new DriveUploadTargetMissingError(folderId);
  }
  if (folder.myRights && folder.myRights.mayAddChildren === false) {
    throw new DriveUploadForbiddenError(folderId);
  }
  const key = `${folderId}\n${folder.parentId ?? ""}`;
  const checkedAt = checkedAncestors.get(key);
  if (checkedAt !== undefined && Date.now() - checkedAt < ANCESTORS_CHECK_TTL_MS) return;
  if (await isInTrash(session, folder, signal)) {
    checkedAncestors.delete(key);
    throw new DriveUploadTargetMissingError(folderId);
  }
  checkedAncestors.set(key, Date.now());
}
