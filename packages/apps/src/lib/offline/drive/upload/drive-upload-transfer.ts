import type { DriveJmapSession } from "@/lib/api/wgw/drive-jmap";
import { DriveUploadPermanentError } from "@/lib/api/wgw/drive-upload-errors";
import { JmapSetItemError, type JmapFileNode, type SetResponse } from "@/lib/jmap-client";
import {
  sendDriveUploadBytes,
  type DriveUploadProgressUpdate,
} from "@/lib/offline/drive/upload/drive-upload-chunked";
import type {
  DriveUploadChunkState,
  DriveUploadConflictChoice,
  DriveUploadNotice,
  DriveUploadReplaceTarget,
} from "@/lib/offline/drive/upload/drive-upload-schema";
import { assertDriveUploadTarget } from "@/lib/offline/drive/upload/drive-upload-target-check";

export { DriveUploadTooLargeError } from "@/lib/api/wgw/drive-upload-errors";

/** Names tried after a create lost a race for its name. */
const KEEP_BOTH_CREATE_ATTEMPTS = 5;
/** Repeats of one FileNode/set while the server copies a large blob in steps. */
const ATTACH_IN_PROGRESS_REPEATS = 1_000;

export type DriveUploadTransferInput = {
  username: string;
  folderId: string;
  name: string;
  mimeType: string;
  blob: Blob;
  /** The batch's conflict answer; unset when the batch had no conflicts when queued. */
  conflict?: DriveUploadConflictChoice;
  /** *Replace*: the existing file as the user saw it. */
  replaceTarget?: DriveUploadReplaceTarget;
  /** Stored progress of an earlier attempt. */
  chunk?: DriveUploadChunkState;
  /** The node an earlier attempt already created or replaced: read it back, do nothing else. */
  createdNodeId?: string;
  /**
   * Called once the node exists (before the read-back), with the notice the
   * batch gets for it, so both are stored together.
   */
  onCreated?: (nodeId: string, notice?: DriveUploadNotice) => Promise<void>;
  /** Stores chunk progress after every part and assembly step. */
  onProgress?: (update: DriveUploadProgressUpdate) => Promise<void>;
};

export type DriveUploadTransferResult =
  | {
      kind: "uploaded";
      /** The node as the server returns it (`modified` included). */
      node: JmapFileNode;
      finalName: string;
    }
  /** `skip` and the name was taken: nothing was created. */
  | { kind: "skipped" };

/**
 * `name (1).ext`, `name (2).ext`, … — the first one not in `taken`
 * (case-insensitive). A dot at the start is part of the name, not an extension.
 */
export function keepBothName(name: string, taken: ReadonlySet<string>): string {
  const lowerTaken = new Set(Array.from(taken, (value) => value.toLowerCase()));
  if (!lowerTaken.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let n = 1; ; n += 1) {
    const candidate = `${stem} (${n})${extension}`;
    if (!lowerTaken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * One upload: the bytes go to the server (in parts when large, see
 * `sendDriveUploadBytes`), then the file is placed by the conflict policy as
 * the folder is *now*. A free name is a plain create, whatever the choice.
 * A taken name: `skip` creates nothing; `keep_both` creates under the next
 * free `name (n).ext`; `replace` updates the node the user saw, with
 * `expectedBlobId`. A batch without a stored choice keeps both and tells the
 * user. `onExists` is never used.
 */
export async function transferDriveUpload(
  session: DriveJmapSession,
  input: DriveUploadTransferInput,
  signal?: AbortSignal,
): Promise<DriveUploadTransferResult> {
  if (input.createdNodeId) {
    const node = await readNode(session, input.createdNodeId, input.name, signal);
    return { kind: "uploaded", node, finalName: node.name || input.name };
  }
  // A folder that is gone, in the trash, or no longer writable gets no bytes.
  await assertDriveUploadTarget(session, input.folderId, signal);
  // A `skip` whose name is taken sends no bytes at all.
  if (input.conflict === "skip" && (await existingByName(session, input, input.name, signal))) {
    return { kind: "skipped" };
  }
  const blobId = await sendDriveUploadBytes({
    session,
    username: input.username,
    name: input.name,
    mimeType: input.mimeType,
    blob: input.blob,
    ...(input.chunk ? { state: input.chunk } : {}),
    save: async (update) => input.onProgress?.(update),
    ...(signal ? { signal } : {}),
  });
  return placeUpload(session, input, blobId, signal);
}

async function placeUpload(
  session: DriveJmapSession,
  input: DriveUploadTransferInput,
  blobId: string,
  signal?: AbortSignal,
): Promise<DriveUploadTransferResult> {
  const existing = await existingByName(session, input, input.name, signal);
  if (!existing) return createKeepingBoth(session, input, blobId, null, signal);
  switch (input.conflict) {
    case "skip":
      return { kind: "skipped" };
    case "keep_both":
      return createKeepingBoth(session, input, blobId, null, signal);
    case "replace":
      if (input.replaceTarget) return replaceExisting(session, input, existing, blobId, signal);
      // This file had no conflict when the user chose: they never saw it.
      return createKeepingBoth(session, input, blobId, "kept_both", signal);
    default:
      return createKeepingBoth(session, input, blobId, "kept_both", signal);
  }
}

/**
 * Updates the node the user saw with `expectedBlobId`. A changed file
 * (`versionMismatch`, or another node under that name now) is never
 * overwritten: the upload keeps both and the batch gets `replace_fell_back`.
 * Without the version check in the Session there is no safe overwrite, so
 * the item fails instead.
 */
async function replaceExisting(
  session: DriveJmapSession,
  input: DriveUploadTransferInput,
  existing: JmapFileNode,
  blobId: string,
  signal?: AbortSignal,
): Promise<DriveUploadTransferResult> {
  const target = input.replaceTarget!;
  if (!session.uploadCapabilities.versionCheck) {
    throw new DriveUploadPermanentError(
      `The server no longer checks file versions, so "${input.name}" was not replaced.`,
    );
  }
  if (existing.id !== target.nodeId) {
    return createKeepingBoth(session, input, blobId, "replace_fell_back", signal);
  }
  try {
    await repeatWhileAttaching(() =>
      session.fileNodes.setFileNodes(
        {
          accountId: session.accountId,
          update: { [target.nodeId]: { blobId, expectedBlobId: target.blobId } },
        },
        { signal },
      ),
    );
  } catch (error) {
    if (error instanceof JmapSetItemError && error.setError.type === "versionMismatch") {
      return createKeepingBoth(session, input, blobId, "replace_fell_back", signal);
    }
    throw error;
  }
  await input.onCreated?.(target.nodeId);
  const node = await readNode(session, target.nodeId, input.name, signal);
  return { kind: "uploaded", node, finalName: node.name || input.name };
}

async function readNode(
  session: DriveJmapSession,
  id: string,
  name: string,
  signal?: AbortSignal,
): Promise<JmapFileNode> {
  const got = await session.fileNodes.getFileNodes(session.accountId, [id], { signal });
  const node = got.list.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`The new file "${name}" could not be read back.`);
  return node;
}

/**
 * A plain create under the first free name. When the name is taken (or a
 * create loses a race for it), the next `name (n).ext`. `notice` is stored
 * on the batch when the file ends up under another name than its own.
 */
async function createKeepingBoth(
  session: DriveJmapSession,
  input: DriveUploadTransferInput,
  blobId: string,
  notice: "kept_both" | "replace_fell_back" | null,
  signal?: AbortSignal,
): Promise<DriveUploadTransferResult> {
  let taken: Set<string> | null = null;
  let name = input.name;
  if (await existingByName(session, input, name, signal)) {
    taken = await childNames(session, input.folderId, signal);
    name = keepBothName(input.name, taken);
  }
  for (let attempt = 0; attempt < KEEP_BOTH_CREATE_ATTEMPTS; attempt += 1) {
    try {
      const created = await repeatWhileAttaching(() =>
        session.fileNodes.setFileNodes(
          {
            accountId: session.accountId,
            create: { upload: { parentId: input.folderId, name, blobId } },
          },
          { signal },
        ),
      );
      const id = created.created?.upload?.id;
      if (!id) throw new Error(`The server did not return the new file "${name}".`);
      const batchNotice =
        notice && name !== input.name
          ? { type: notice, itemName: input.name, keptAsName: name }
          : undefined;
      await input.onCreated?.(id, batchNotice);
      const node = await readNode(session, id, name, signal);
      return { kind: "uploaded", node, finalName: node.name || name };
    } catch (error) {
      if (!(error instanceof JmapSetItemError) || error.setError.type !== "alreadyExists") {
        throw error;
      }
      // Under `skip`, a name taken by a race is still a collision.
      if (input.conflict === "skip" && name === input.name) return { kind: "skipped" };
      taken ??= await childNames(session, input.folderId, signal);
      taken.add(name);
      name = keepBothName(input.name, taken);
    }
  }
  throw new Error(`No free name found for "${input.name}".`);
}

/**
 * The server copies a large blob onto a node in steps: until it is done,
 * the same FileNode/set fails with `attachInProgress` and is sent again.
 */
async function repeatWhileAttaching(
  call: () => Promise<SetResponse<JmapFileNode>>,
): Promise<SetResponse<JmapFileNode>> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      const attaching =
        error instanceof JmapSetItemError && error.setError.type === "attachInProgress";
      if (!attaching || attempt >= ATTACH_IN_PROGRESS_REPEATS) throw error;
    }
  }
}

async function existingByName(
  session: DriveJmapSession,
  input: Pick<DriveUploadTransferInput, "folderId">,
  name: string,
  signal?: AbortSignal,
): Promise<JmapFileNode | null> {
  const got = await session.fileNodes.queryAndGetFileNodes(
    session.accountId,
    { parentId: input.folderId, name },
    { signal },
  );
  return (
    got.list.find((node) => node.name.toLowerCase() === name.toLowerCase()) ?? got.list[0] ?? null
  );
}

async function childNames(
  session: DriveJmapSession,
  folderId: string,
  signal?: AbortSignal,
): Promise<Set<string>> {
  const got = await session.fileNodes.queryAndGetFileNodes(
    session.accountId,
    { parentId: folderId },
    { signal },
  );
  return new Set(got.list.map((node) => node.name));
}
