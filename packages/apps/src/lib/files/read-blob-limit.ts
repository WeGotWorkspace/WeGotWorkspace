/** Largest file `readFileBlob` fetches into memory (previews, opening a file). */
export const DRIVE_READ_BLOB_MAX_BYTES = 100 * 1024 * 1024;

/** A file too large to open in the browser; download it instead. */
export class DriveFileTooLargeToOpenError extends Error {
  constructor(
    readonly fileName: string,
    readonly size: number,
  ) {
    super(`"${fileName}" is too large to open in the browser. Download it instead.`);
    this.name = "DriveFileTooLargeToOpenError";
  }
}

/**
 * Reads a response body into a Blob, but never more than `limit` bytes.
 * Refuses on a `Content-Length` above the limit before reading, and stops
 * reading as soon as the bytes received pass it. Either way the body is
 * cancelled and {@link DriveFileTooLargeToOpenError} is thrown.
 */
export async function readResponseBlobWithin(
  res: Response,
  limit: number,
  fileName: string,
): Promise<Blob> {
  const type = res.headers.get("Content-Type") ?? "";
  const declared = Number(res.headers.get("Content-Length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > limit) {
    await res.body?.cancel().catch(() => undefined);
    throw new DriveFileTooLargeToOpenError(fileName, declared);
  }
  if (!res.body) return new Blob([], { type });

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limit) {
      await reader.cancel().catch(() => undefined);
      throw new DriveFileTooLargeToOpenError(fileName, received);
    }
    chunks.push(value);
  }
  return new Blob(chunks as BlobPart[], { type });
}
