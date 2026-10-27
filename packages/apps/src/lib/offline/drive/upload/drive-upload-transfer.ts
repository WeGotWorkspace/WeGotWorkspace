import { uploadJmapBlob, type DriveJmapSession } from "@/lib/api/wgw/drive-jmap";
import { JmapSetItemError, type JmapFileNode } from "@/lib/jmap-client";

/** Names tried after a create lost a race for its name. */
const KEEP_BOTH_CREATE_ATTEMPTS = 5;

export class DriveUploadTooLargeError extends Error {
  constructor(
    readonly fileName: string,
    readonly maxBytes: number,
  ) {
    super(`"${fileName}" is larger than this server accepts in one upload.`);
    this.name = "DriveUploadTooLargeError";
  }
}

export type DriveUploadTransferInput = {
  folderId: string;
  name: string;
  mimeType: string;
  blob: Blob;
  /** The node an earlier attempt already created: read it back, do not upload or create. */
  createdNodeId?: string;
  /** Called with the new id before the read-back, so it can be stored. */
  onCreated?: (nodeId: string) => Promise<void>;
};

export type DriveUploadTransferResult = {
  /** The created node as the server returns it (`modified` included). */
  node: JmapFileNode;
  finalName: string;
};

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
 * One whole-file upload: the bytes go to `/jmap/upload` through `wgwFetch`
 * (token refresh and the single 401 retry apply), then a plain create in the
 * target folder. A name that is taken becomes the next free `name (n).ext`.
 * This never updates or replaces an existing node.
 */
export async function transferDriveUpload(
  session: DriveJmapSession,
  input: DriveUploadTransferInput,
  signal?: AbortSignal,
): Promise<DriveUploadTransferResult> {
  if (input.createdNodeId) {
    const node = await readNode(session, input.createdNodeId, input.name, signal);
    return { node, finalName: node.name || input.name };
  }
  if (input.blob.size > session.maxSizeUpload) {
    throw new DriveUploadTooLargeError(input.name, session.maxSizeUpload);
  }
  const blobId = await uploadJmapBlob(session, input.blob, input.mimeType, signal);
  return createKeepingBoth(session, input, blobId, signal);
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

async function createKeepingBoth(
  session: DriveJmapSession,
  input: DriveUploadTransferInput,
  blobId: string,
  signal?: AbortSignal,
): Promise<DriveUploadTransferResult> {
  let taken: Set<string> | null = null;
  let name = input.name;
  if (await nameIsTaken(session, input.folderId, name, signal)) {
    taken = await childNames(session, input.folderId, signal);
    name = keepBothName(input.name, taken);
  }
  for (let attempt = 0; attempt < KEEP_BOTH_CREATE_ATTEMPTS; attempt += 1) {
    try {
      const node = await createNode(session, input.folderId, name, blobId, input.onCreated, signal);
      return { node, finalName: node.name || name };
    } catch (error) {
      if (!(error instanceof JmapSetItemError) || error.setError.type !== "alreadyExists") {
        throw error;
      }
      taken ??= await childNames(session, input.folderId, signal);
      taken.add(name);
      name = keepBothName(input.name, taken);
    }
  }
  throw new Error(`No free name found for "${input.name}".`);
}

async function nameIsTaken(
  session: DriveJmapSession,
  folderId: string,
  name: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const got = await session.fileNodes.queryAndGetFileNodes(
    session.accountId,
    { parentId: folderId, name },
    { signal },
  );
  return got.list.length > 0;
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

async function createNode(
  session: DriveJmapSession,
  folderId: string,
  name: string,
  blobId: string,
  onCreated: ((nodeId: string) => Promise<void>) | undefined,
  signal?: AbortSignal,
): Promise<JmapFileNode> {
  const created = await session.fileNodes.setFileNodes(
    { accountId: session.accountId, create: { upload: { parentId: folderId, name, blobId } } },
    { signal },
  );
  const id = created.created?.upload?.id;
  if (!id) throw new Error(`The server did not return the new file "${name}".`);
  await onCreated?.(id);
  return readNode(session, id, name, signal);
}
