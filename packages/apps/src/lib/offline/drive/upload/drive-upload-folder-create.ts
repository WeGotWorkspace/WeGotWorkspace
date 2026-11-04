import type { DriveJmapSession } from "@/lib/api/wgw/drive-jmap";
import { JmapSetItemError, type JmapFileNode } from "@/lib/jmap-client";
import { childNames, existingByName } from "@/lib/offline/drive/upload/drive-upload-node-lookup";
import type {
  DriveUploadFolderOnExisting,
  DriveUploadPlacing,
} from "@/lib/offline/drive/upload/drive-upload-schema";
import { assertDriveUploadTarget } from "@/lib/offline/drive/upload/drive-upload-target-check";
import { keepBothName } from "@/lib/offline/drive/upload/drive-upload-transfer";

/** Names tried after a create lost a race for its name. */
const KEEP_BOTH_CREATE_ATTEMPTS = 5;

export type CreateDriveUploadFolderInput = {
  parentId: string;
  /** The planned name. */
  name: string;
  /** The folder's own name; `name (1)`, `name (2)`, … are built from it. */
  sourceName: string;
  /** A folder already there under `name`: add into it, or create the next free name. */
  onExisting: DriveUploadFolderOnExisting;
  /** The last create an earlier attempt sent, whose answer may have been lost. */
  placing?: DriveUploadPlacing;
  /** Stores the create before it is sent (and its id once it is known); null clears it. */
  onPlacing: (placing: DriveUploadPlacing | null) => Promise<void>;
};

function isFolder(node: JmapFileNode | null, parentId: string): node is JmapFileNode {
  return node?.nodeType === "directory" && node.parentId === parentId;
}

async function readNode(
  session: DriveJmapSession,
  id: string,
  signal?: AbortSignal,
): Promise<JmapFileNode | null> {
  const got = await session.fileNodes.getFileNodes(session.accountId, [id], { signal });
  return got.list.find((node) => node.id === id) ?? null;
}

async function folderNamed(
  session: DriveJmapSession,
  parentId: string,
  name: string,
  signal?: AbortSignal,
): Promise<JmapFileNode | null> {
  const node = await existingByName(session, { folderId: parentId }, name, signal);
  return isFolder(node, parentId) && node.name.toLowerCase() === name.toLowerCase() ? node : null;
}

/**
 * The folder an earlier attempt created: by the id it stored, or, when the
 * answer was lost, by the name that create was sent with.
 */
async function earlierCreate(
  session: DriveJmapSession,
  input: CreateDriveUploadFolderInput,
  signal?: AbortSignal,
): Promise<JmapFileNode | null> {
  const { placing } = input;
  if (placing?.folderId !== input.parentId) return null;
  if (placing.nodeId) {
    const node = await readNode(session, placing.nodeId, signal);
    if (isFolder(node, input.parentId)) return node;
  }
  return folderNamed(session, input.parentId, placing.name, signal);
}

/**
 * One folder of a folder upload, under a parent that exists. Never creates
 * twice: a retry or reload finds the folder an earlier attempt made. A
 * folder already there under the planned name is added into with `merge`
 * (nested folders always merge); otherwise, or when the name belongs to a
 * file, the folder gets the next free `name (n)`. A create that loses a race
 * for its name tries the next one, or adds into the winner with `merge`.
 */
export async function createDriveUploadFolder(
  session: DriveJmapSession,
  input: CreateDriveUploadFolderInput,
  signal?: AbortSignal,
): Promise<JmapFileNode> {
  // A parent that is gone, in the trash, or no longer writable gets no folder.
  await assertDriveUploadTarget(session, input.parentId, signal);
  const earlier = await earlierCreate(session, input, signal);
  if (earlier) return earlier;
  const merge = input.onExisting === "merge";
  let taken: Set<string> | null = null;
  let name = input.name;
  if (await existingByName(session, { folderId: input.parentId }, name, signal)) {
    const existing = merge ? await folderNamed(session, input.parentId, name, signal) : null;
    if (existing) return existing;
    taken = await childNames(session, input.parentId, signal);
    name = keepBothName(input.sourceName, taken, "folder");
  }
  for (let attempt = 0; attempt < KEEP_BOTH_CREATE_ATTEMPTS; attempt += 1) {
    await input.onPlacing({ folderId: input.parentId, name });
    try {
      const created = await session.fileNodes.setFileNodes(
        { accountId: session.accountId, create: { folder: { parentId: input.parentId, name } } },
        { signal },
      );
      const id = created.created?.folder?.id;
      if (!id) throw new Error(`The server did not return the new folder "${name}".`);
      await input.onPlacing({ folderId: input.parentId, name, nodeId: id });
      const node = await readNode(session, id, signal);
      if (!node) throw new Error(`The new folder "${name}" could not be read back.`);
      return node;
    } catch (error) {
      if (!(error instanceof JmapSetItemError) || error.setError.type !== "alreadyExists") {
        throw error;
      }
      // Not ours: a reload now must not take that folder for its own.
      await input.onPlacing(null);
      const winner = merge ? await folderNamed(session, input.parentId, name, signal) : null;
      if (winner) return winner;
      taken ??= await childNames(session, input.parentId, signal);
      taken.add(name);
      name = keepBothName(input.sourceName, taken, "folder");
    }
  }
  throw new Error(`No free name found for the folder "${input.sourceName}".`);
}
