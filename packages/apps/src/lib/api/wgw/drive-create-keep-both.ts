import {
  driveJmapSession,
  fetchDriveUser,
  resolveFileNodeId,
  uploadJmapBlob,
} from "@/lib/api/wgw/drive-jmap";
import { JmapSetItemError } from "@/lib/jmap-client";
import { keepBothName } from "@/lib/offline/drive/upload/drive-upload-transfer";

/** Names tried when another create takes the free name first. */
const KEEP_BOTH_ATTEMPTS = 5;

export type CreateKeepingBothOptions = {
  signal?: AbortSignal;
  /**
   * An earlier attempt of this create may have landed with its answer lost.
   * A file under the wanted name with exactly this file's size is then taken
   * as that create, not as a clash.
   */
  mayHaveLanded?: boolean;
};

/**
 * Create `file` in `parentPath` without ever replacing a file that is there:
 * a taken name keeps both, under the first free `name (n).ext` (Drive's
 * keep-both rule). Returns the name the file has on the server.
 */
export async function createDriveFileKeepingBoth(
  parentPath: string,
  file: File,
  opts: CreateKeepingBothOptions = {},
): Promise<string> {
  const { signal } = opts;
  const session = await driveJmapSession();
  const user = await fetchDriveUser(opts);
  const parentId = await resolveFileNodeId(session, parentPath, user.username, signal);
  const siblings = async () =>
    (await session.fileNodes.queryAndGetFileNodes(session.accountId, { parentId }, { signal }))
      .list;
  if (opts.mayHaveLanded) {
    const wanted = file.name.toLowerCase();
    const own = (await siblings()).find(
      (node) =>
        node.name.toLowerCase() === wanted &&
        node.nodeType !== "directory" &&
        node.size === file.size,
    );
    if (own) return own.name;
  }
  const blobId = await uploadJmapBlob(
    session,
    file,
    file.type || "application/octet-stream",
    signal,
  );
  let name = file.name;
  for (let attempt = 0; attempt < KEEP_BOTH_ATTEMPTS; attempt += 1) {
    try {
      await session.fileNodes.setFileNodes(
        { accountId: session.accountId, create: { f0: { parentId, name, blobId } } },
        { signal },
      );
      return name;
    } catch (error) {
      if (!(error instanceof JmapSetItemError) || error.setError.type !== "alreadyExists") {
        throw error;
      }
      name = keepBothName(file.name, new Set((await siblings()).map((node) => node.name)));
    }
  }
  throw new Error(`No free name was found for "${file.name}".`);
}
