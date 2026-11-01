import {
  DriveTransportError,
  expandJmapUrl,
  toApiRelativePath,
  type DriveJmapSession,
} from "@/lib/api/wgw/drive-jmap";
import {
  DriveAssemblyStepTooLargeError,
  DriveServerFullError,
  DriveUploadPartRejectedError,
  DriveUploadPartsMissingError,
  DriveUploadPermanentError,
  DriveUploadTooLargeError,
} from "@/lib/api/wgw/drive-upload-errors";
import { wgwFetch } from "@/lib/api/wgw/http";
import {
  BLOB_ASSEMBLY_CAPABILITY,
  BLOB_CAPABILITY,
  CORE_CAPABILITY,
  JmapMethodError,
  JmapRequestError,
  type JmapSetError,
} from "@/lib/jmap-client";

const LIMIT_PROBLEM = "urn:ietf:params:jmap:error:limit";
const PART_MISMATCH_PROBLEM = "https://wegotworkspace.org/jmap/problem/part-mismatch";

const BLOB_USING = [CORE_CAPABILITY, BLOB_CAPABILITY];
const ASSEMBLY_USING = [CORE_CAPABILITY, BLOB_ASSEMBLY_CAPABILITY];

export type UploadedJmapPart = { blobId: string; size: number };

export type JmapPartHeaders = {
  mediaType: string;
  /** Hex sha256 of the part; omitted for a small file without Web Crypto. */
  sha256?: string;
  /** Claims the part for this open assembly, so cleanup leaves it alone. */
  assemblyId?: string;
};

/**
 * One part (or a whole small file) to `/jmap/upload` through `wgwFetch`, with
 * its length and sha256 declared so the server can refuse a body the host cut
 * short. Size refusals become {@link DriveUploadPartRejectedError}; a full
 * disk becomes {@link DriveServerFullError}.
 */
export async function uploadJmapPart(
  session: DriveJmapSession,
  part: Blob,
  headers: JmapPartHeaders,
  signal?: AbortSignal,
): Promise<UploadedJmapPart> {
  const url = expandJmapUrl(session.uploadUrl, { accountId: session.accountId });
  const res = await wgwFetch(toApiRelativePath(url), {
    method: "POST",
    headers: {
      "Content-Type": headers.mediaType || "application/octet-stream",
      "Wgw-Part-Length": String(part.size),
      ...(headers.sha256 ? { "Wgw-Part-Sha256": headers.sha256 } : {}),
      ...(headers.assemblyId ? { "Wgw-Assembly-Id": headers.assemblyId } : {}),
    },
    body: part,
    signal,
  });
  if (res.ok) {
    const payload = (await res.json()) as { blobId?: string; size?: number };
    if (!payload.blobId) throw new Error("JMAP upload returned no blobId");
    return {
      blobId: payload.blobId,
      size: typeof payload.size === "number" ? payload.size : part.size,
    };
  }
  if (res.status === 413) throw new DriveUploadPartRejectedError("http_413", 413);
  if (res.status === 507) throw new DriveServerFullError();
  if (res.status === 400) {
    const problem = await readProblemType(res);
    if (problem === LIMIT_PROBLEM) throw new DriveUploadPartRejectedError("limit", 400);
    if (problem === PART_MISMATCH_PROBLEM) {
      throw new DriveUploadPartRejectedError("part_mismatch", 400);
    }
  }
  throw new DriveTransportError(`POST /jmap/upload failed (${res.status})`, res.status);
}

async function readProblemType(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { type?: unknown };
    return typeof body.type === "string" ? body.type : undefined;
  } catch {
    return undefined;
  }
}

/** A request-level 507 is a full server; any other request failure is rethrown as is. */
function rethrowRequestFailure(error: unknown, onLimit?: () => Error): never {
  if (error instanceof JmapRequestError) {
    if (error.status === 507) throw new DriveServerFullError();
    if (onLimit && error.status === 400 && error.problemType === LIMIT_PROBLEM) throw onLimit();
  }
  throw error;
}

function setErrorFailure(setError: JmapSetError, what: string): Error {
  if (setError.type === "overQuota") return new DriveServerFullError();
  if (setError.type === "blobNotFound") {
    const notFound = Array.isArray(setError.notFound) ? (setError.notFound as string[]) : [];
    return new DriveUploadPartsMissingError(notFound);
  }
  const detail = setError.description ? `: ${setError.description}` : "";
  return new DriveUploadPermanentError(`${what} failed (${setError.type})${detail}`);
}

/**
 * RFC 9404 `Blob/upload` joining the parts in order into one blob, in one
 * call. It is never split: a call that does not fit (a `limit` or
 * `requestTooLarge`) is a permanent failure for the file.
 */
export async function joinJmapBlobParts(
  session: DriveJmapSession,
  blobIds: readonly string[],
  mediaType: string,
  signal?: AbortSignal,
): Promise<string> {
  type BlobUploadResponse = {
    created?: Record<string, { id: string }> | null;
    notCreated?: Record<string, JmapSetError> | null;
  };
  let response: BlobUploadResponse;
  try {
    response = await session.client.call<BlobUploadResponse>(
      "Blob/upload",
      {
        accountId: session.accountId,
        create: {
          file: { data: blobIds.map((blobId) => ({ blobId })), type: mediaType || null },
        },
      },
      { using: BLOB_USING, signal },
    );
  } catch (error) {
    if (error instanceof JmapMethodError) {
      throw new DriveUploadPermanentError(
        error.errorType === "requestTooLarge"
          ? "The parts do not fit in one Blob/upload call on this server."
          : `Blob/upload failed (${error.errorType}).`,
      );
    }
    rethrowRequestFailure(
      error,
      () => new DriveUploadPermanentError("The parts do not fit in one Blob/upload call."),
    );
  }
  const created = response.created?.file?.id;
  if (created) return created;
  const setError = response.notCreated?.file;
  if (setError) throw setErrorFailure(setError, "Blob/upload");
  throw new Error("Blob/upload returned no blob.");
}

export type JmapBlobAssembly = {
  id: string;
  received: number;
  nextIndex: number;
  acceptedParts: number[];
  status: "open" | "finished";
  blobId: string | null;
};

/** `BlobAssembly/set` create: an assembly of `size` octets. */
export async function createJmapBlobAssembly(
  session: DriveJmapSession,
  size: number,
  mediaType: string,
  fileName: string,
  signal?: AbortSignal,
): Promise<string> {
  type SetResponse = {
    created?: Record<string, { id: string }> | null;
    notCreated?: Record<string, JmapSetError> | null;
  };
  let response: SetResponse;
  try {
    response = await session.client.call<SetResponse>(
      "BlobAssembly/set",
      { accountId: session.accountId, create: { file: { size, type: mediaType || null } } },
      { using: ASSEMBLY_USING, signal },
    );
  } catch (error) {
    rethrowRequestFailure(error);
  }
  const id = response.created?.file?.id;
  if (id) return id;
  const setError = response.notCreated?.file;
  if (setError?.type === "tooLarge") {
    throw new DriveUploadTooLargeError(fileName, Number(setError.maxSize) || 0);
  }
  if (setError) throw setErrorFailure(setError, "BlobAssembly/set");
  throw new Error("BlobAssembly/set returned no assembly.");
}

export type JmapAssemblyAppendResult = {
  /** Every index of the request that is now part of the assembly. */
  accepted: number[];
  /** The call only advanced a hash rebuild and accepted no new part. */
  rebuiltOnly: boolean;
  received: number;
  nextIndex: number;
};

/**
 * `BlobAssembly/append`. A `limit` or `requestTooLarge` becomes
 * {@link DriveAssemblyStepTooLargeError} (send fewer parts per call); missing
 * parts become {@link DriveUploadPartsMissingError}.
 */
export async function appendJmapBlobAssembly(
  session: DriveJmapSession,
  assemblyId: string,
  parts: ReadonlyArray<{ index: number; blobId: string }>,
  signal?: AbortSignal,
): Promise<JmapAssemblyAppendResult> {
  try {
    const response = await session.client.call<Partial<JmapAssemblyAppendResult>>(
      "BlobAssembly/append",
      { accountId: session.accountId, id: assemblyId, parts },
      { using: ASSEMBLY_USING, signal },
    );
    return {
      accepted: Array.isArray(response.accepted) ? response.accepted : [],
      rebuiltOnly: response.rebuiltOnly === true,
      received: Number(response.received) || 0,
      nextIndex: Number(response.nextIndex) || 0,
    };
  } catch (error) {
    if (error instanceof JmapMethodError) {
      if (error.errorType === "requestTooLarge" || error.errorType === "limit") {
        throw new DriveAssemblyStepTooLargeError();
      }
      if (error.errorType === "blobNotFound") {
        const notFound = Array.isArray(error.args.notFound)
          ? (error.args.notFound as string[])
          : [];
        throw new DriveUploadPartsMissingError(notFound);
      }
    }
    rethrowRequestFailure(error, () => new DriveAssemblyStepTooLargeError());
  }
}

/** `BlobAssembly/finish`. `blobId` is null while a hash rebuild still has steps left. */
export async function finishJmapBlobAssembly(
  session: DriveJmapSession,
  assemblyId: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const response = await session.client.call<{ blobId?: string | null }>(
      "BlobAssembly/finish",
      { accountId: session.accountId, id: assemblyId },
      { using: ASSEMBLY_USING, signal },
    );
    return typeof response.blobId === "string" ? response.blobId : null;
  } catch (error) {
    rethrowRequestFailure(error);
  }
}

/** `BlobAssembly/get` for one id; null when it is unknown or expired. */
export async function getJmapBlobAssembly(
  session: DriveJmapSession,
  assemblyId: string,
  signal?: AbortSignal,
): Promise<JmapBlobAssembly | null> {
  try {
    const response = await session.client.call<{ list?: JmapBlobAssembly[] }>(
      "BlobAssembly/get",
      { accountId: session.accountId, ids: [assemblyId] },
      { using: ASSEMBLY_USING, signal },
    );
    return response.list?.find((row) => row.id === assemblyId) ?? null;
  } catch (error) {
    rethrowRequestFailure(error);
  }
}
