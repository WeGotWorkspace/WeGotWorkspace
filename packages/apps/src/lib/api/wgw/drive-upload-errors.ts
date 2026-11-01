/**
 * Typed failures of the chunked upload (#1519). The uploader turns each into
 * an item error code; anything else is classified by HTTP status.
 */

/**
 * `/jmap/upload` refused a part for its size: a 413 (front controller or a
 * proxy), an RFC 8620 `limit` problem, or a stored part whose length or
 * sha256 differs from what was sent (a body the host discarded). The
 * uploader halves its part size and sends the part again.
 */
export class DriveUploadPartRejectedError extends Error {
  constructor(
    readonly reason: "http_413" | "limit" | "part_mismatch",
    readonly status: number,
  ) {
    super(`The server refused an upload part (${reason}).`);
    this.name = "DriveUploadPartRejectedError";
  }
}

/** A file the server cannot take, even in parts at the smallest part size. */
export class DriveUploadTooLargeError extends Error {
  constructor(
    readonly fileName: string,
    readonly maxBytes: number,
  ) {
    super(`"${fileName}" is larger than this server accepts.`);
    this.name = "DriveUploadTooLargeError";
  }
}

/** 507 or `overQuota`: never retried with backoff; pauses the whole queue (#1520). */
export class DriveServerFullError extends Error {
  constructor(message = "The server has no space left for this file.") {
    super(message);
    this.name = "DriveServerFullError";
  }
}

/** A file larger than one upload on an `http://` install: no Web Crypto for part checksums. */
export class DriveUploadInsecureContextError extends Error {
  constructor() {
    super("Large files need a secure connection (https).");
    this.name = "DriveUploadInsecureContextError";
  }
}

/**
 * The target folder is gone: deleted, or moved to the trash (#1520). The
 * file can be sent to another folder (its stored `Blob` stays) or removed.
 */
export class DriveUploadTargetMissingError extends Error {
  constructor(readonly folderId: string) {
    super("The folder this file was going to no longer exists.");
    this.name = "DriveUploadTargetMissingError";
  }
}

/** The account may no longer add files to the target folder (e.g. write access was revoked). */
export class DriveUploadForbiddenError extends Error {
  constructor(readonly folderId: string) {
    super("You can no longer add files to this folder.");
    this.name = "DriveUploadForbiddenError";
  }
}

/** A failure retrying cannot fix (the `permanent` class); the message says why. */
export class DriveUploadPermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriveUploadPermanentError";
  }
}

/** `blobNotFound`: these parts expired or vanished; only they are sent again. */
export class DriveUploadPartsMissingError extends Error {
  constructor(readonly blobIds: readonly string[]) {
    super(`${blobIds.length} upload part(s) are gone from the server.`);
    this.name = "DriveUploadPartsMissingError";
  }
}

/** A `limit` (or `requestTooLarge`) on one assembly step: fewer parts per call. */
export class DriveAssemblyStepTooLargeError extends Error {
  constructor() {
    super("The server refused this assembly step as too large.");
    this.name = "DriveAssemblyStepTooLargeError";
  }
}

/** `versionMismatch`: the file changed since the user chose *Replace*. Nothing was overwritten. */
export class DriveVersionMismatchError extends Error {
  constructor(
    readonly existingId: string | undefined,
    readonly existingBlobId: string | undefined,
  ) {
    super("The file changed since Replace was chosen.");
    this.name = "DriveVersionMismatchError";
  }
}
