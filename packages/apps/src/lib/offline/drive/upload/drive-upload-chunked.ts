import {
  appendJmapBlobAssembly,
  createJmapBlobAssembly,
  finishJmapBlobAssembly,
  getJmapBlobAssembly,
  joinJmapBlobParts,
  uploadJmapPart,
} from "@/lib/api/wgw/drive-blob-jmap";
import type { DriveJmapSession } from "@/lib/api/wgw/drive-jmap";
import {
  DriveAssemblyStepTooLargeError,
  DriveUploadInsecureContextError,
  DriveUploadPartRejectedError,
  DriveUploadPartsMissingError,
  DriveUploadPermanentError,
  DriveUploadTooLargeError,
} from "@/lib/api/wgw/drive-upload-errors";
import { JmapMethodError } from "@/lib/jmap-client";
import {
  halvedPartSize,
  initialPartSize,
  rememberPartSize,
} from "@/lib/offline/drive/upload/drive-upload-part-size";
import type {
  DriveUploadChunkState,
  DriveUploadPart,
} from "@/lib/offline/drive/upload/drive-upload-schema";

/** Rounds of re-sending parts the server reported missing before giving up. */
const MISSING_PART_ROUNDS = 3;

export type DriveUploadProgressUpdate = {
  state: DriveUploadChunkState;
  /** Octets of the file the server has as parts. */
  bytesDone: number;
  /** Set once every part is sent and the server is putting the file together. */
  phase?: "assembling";
  assembledBytes?: number;
};

export type SendDriveUploadInput = {
  session: DriveJmapSession;
  username: string;
  name: string;
  mimeType: string;
  blob: Blob;
  /** Stored progress of an earlier attempt (after a reload or reconnect). */
  state?: DriveUploadChunkState;
  /** Stores progress; called after every part and every assembly step. */
  save: (update: DriveUploadProgressUpdate) => Promise<void>;
  signal?: AbortSignal;
};

function subtleCrypto(): SubtleCrypto | null {
  const subtle = globalThis.crypto?.subtle;
  return subtle && typeof subtle.digest === "function" ? subtle : null;
}

async function sha256Hex(subtle: SubtleCrypto, part: Blob): Promise<string> {
  const digest = await subtle.digest("SHA-256", await part.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function partsEnd(parts: readonly DriveUploadPart[]): number {
  const last = parts.at(-1);
  return last ? last.offset + last.length : 0;
}

function bytesOf(parts: readonly DriveUploadPart[]): number {
  return parts.reduce((sum, part) => sum + part.length, 0);
}

/**
 * Sends one file's bytes and returns the blob that holds the whole file. A
 * file that fits in one part is one `/jmap/upload`. A larger file goes in
 * parts, one after another, each with its length and sha256 declared; the
 * server then joins them, through the blob assembly extension in steps
 * within its budget, or with one plain `Blob/upload` without it. Progress is
 * stored after every part and step, so a later call with the stored `state`
 * resumes from the next one.
 */
export async function sendDriveUploadBytes(input: SendDriveUploadInput): Promise<string> {
  const run = new ChunkedUpload(input);
  return run.send();
}

class ChunkedUpload {
  private readonly state: DriveUploadChunkState;
  private readonly subtle = subtleCrypto();

  constructor(private readonly input: SendDriveUploadInput) {
    const { session, username } = input;
    this.state = input.state
      ? { ...input.state, parts: [...input.state.parts] }
      : {
          partSize: initialPartSize(username, session.maxSizeUpload, session.uploadCapabilities),
          parts: [],
          appendedParts: 0,
        };
  }

  private get size(): number {
    return this.input.blob.size;
  }

  async send(): Promise<string> {
    if (this.state.blobId) return this.state.blobId;
    // https is a WGW requirement (#1526): no checksum fallback for large files.
    if (!this.subtle && this.size > this.input.session.maxSizeUpload) {
      throw new DriveUploadInsecureContextError();
    }
    const single = await this.sendParts();
    if (single) return single;
    return this.state.join === "assembly" ? this.assemble() : this.joinWithBlobUpload();
  }

  private async save(extra: Omit<DriveUploadProgressUpdate, "state" | "bytesDone"> = {}) {
    await this.input.save({
      state: { ...this.state, parts: [...this.state.parts] },
      bytesDone: partsEnd(this.state.parts),
      ...extra,
    });
  }

  /** Uploads the remaining parts; returns the blob id when the file was one part. */
  private async sendParts(): Promise<string | null> {
    for (;;) {
      const offset = partsEnd(this.state.parts);
      if (this.state.parts.length > 0 && offset >= this.size) return null;
      const whole = this.state.parts.length === 0 && this.size <= this.state.partSize;
      if (!whole) await this.prepareJoin();
      const length = whole ? this.size : Math.min(this.state.partSize, this.size - offset);
      const part = this.input.blob.slice(offset, offset + length);
      let blobId: string;
      try {
        blobId = await this.uploadPart(part, whole);
      } catch (error) {
        if (!(error instanceof DriveUploadPartRejectedError)) throw error;
        await this.shrinkAfterRefusal(length);
        continue;
      }
      this.state.parts.push({ offset, length, blobId });
      if (whole) this.state.blobId = blobId;
      await this.save();
      if (whole) return blobId;
    }
  }

  private async uploadPart(part: Blob, whole: boolean): Promise<string> {
    const sha256 = this.subtle ? await sha256Hex(this.subtle, part) : undefined;
    const { blobId } = await uploadJmapPart(
      this.input.session,
      part,
      {
        mediaType: whole ? this.input.mimeType : "application/octet-stream",
        ...(sha256 ? { sha256 } : {}),
        ...(this.state.assemblyId ? { assemblyId: this.state.assemblyId } : {}),
      },
      this.input.signal,
    );
    return blobId;
  }

  /**
   * A 413, a `limit`, or a part stored short or corrupt: halve the part size
   * (remembered for later files) and send that part again. At the floor the
   * file is too large.
   */
  private async shrinkAfterRefusal(refusedLength: number): Promise<void> {
    const next = halvedPartSize(refusedLength);
    if (next === null) {
      throw new DriveUploadTooLargeError(this.input.name, refusedLength);
    }
    this.state.partSize = next;
    rememberPartSize(this.input.username, next);
    await this.save();
  }

  /** Picks how the parts become one file, and opens the assembly, before the first part. */
  private async prepareJoin(): Promise<void> {
    const { session, name, mimeType, signal } = this.input;
    const caps = session.uploadCapabilities;
    if (!this.subtle) throw new DriveUploadInsecureContextError();
    if (!this.state.join) {
      if (caps.assembly) this.state.join = "assembly";
      else if (caps.blob) this.state.join = "blob_upload";
      else throw new DriveUploadTooLargeError(name, session.maxSizeUpload);
    }
    if (this.state.join === "blob_upload") {
      this.checkBlobUploadFits();
      return;
    }
    const maxSize = caps.assembly?.maxSizeAssembly;
    if (maxSize && this.size > maxSize) throw new DriveUploadTooLargeError(name, maxSize);
    if (!this.state.assemblyId) {
      this.state.assemblyId = await createJmapBlobAssembly(
        session,
        this.size,
        mimeType,
        name,
        signal,
      );
      this.state.appendedParts = 0;
      await this.save();
    }
  }

  /** The plain `Blob/upload` fallback is one call: it is never split into steps. */
  private checkBlobUploadFits(): void {
    const blob = this.input.session.uploadCapabilities.blob;
    if (!blob)
      throw new DriveUploadTooLargeError(this.input.name, this.input.session.maxSizeUpload);
    if (blob.maxSizeBlobSet && this.size > blob.maxSizeBlobSet) {
      throw new DriveUploadTooLargeError(this.input.name, blob.maxSizeBlobSet);
    }
    const sent = this.state.parts.length;
    const remaining = Math.ceil((this.size - partsEnd(this.state.parts)) / this.state.partSize);
    if (sent + remaining > blob.maxDataSources) {
      throw new DriveUploadPermanentError(
        `"${this.input.name}" needs more parts than this server joins in one call (${blob.maxDataSources}).`,
      );
    }
  }

  private async joinWithBlobUpload(): Promise<string> {
    const { session, mimeType, signal } = this.input;
    this.checkBlobUploadFits();
    await this.save({ phase: "assembling", assembledBytes: 0 });
    for (let round = 0; ; round += 1) {
      try {
        const blobIds = this.state.parts.map((part) => part.blobId);
        const blobId = await joinJmapBlobParts(session, blobIds, mimeType, signal);
        this.state.blobId = blobId;
        await this.save({ phase: "assembling", assembledBytes: this.size });
        return blobId;
      } catch (error) {
        if (!(error instanceof DriveUploadPartsMissingError) || round >= MISSING_PART_ROUNDS) {
          throw error;
        }
        await this.resendMissing(error.blobIds);
      }
    }
  }

  /** Sends only the parts the server reported missing (expired), with their old ranges. */
  private async resendMissing(blobIds: readonly string[]): Promise<void> {
    const missing = new Set(blobIds);
    for (const [index, part] of this.state.parts.entries()) {
      if (!missing.has(part.blobId)) continue;
      const bytes = this.input.blob.slice(part.offset, part.offset + part.length);
      let blobId: string;
      try {
        blobId = await this.uploadPart(bytes, false);
      } catch (error) {
        if (error instanceof DriveUploadPartRejectedError) {
          throw new DriveUploadPermanentError("A part the server lost could not be sent again.");
        }
        throw error;
      }
      this.state.parts[index] = { ...part, blobId };
    }
    await this.save({ phase: "assembling", assembledBytes: this.assembledBytes() });
  }

  private assembledBytes(): number {
    return bytesOf(this.state.parts.slice(0, this.state.appendedParts));
  }

  /**
   * Appends the parts in steps within the step budget, then finishes. Starts
   * from what the server says it has (after a time-out or a reload). A
   * `limit` on a step means fewer parts per call, down to one.
   */
  private async assemble(): Promise<string> {
    await this.syncAssembly();
    if (this.state.blobId) return this.state.blobId;
    let missingRounds = 0;
    let resynced = false;
    while (this.state.appendedParts < this.state.parts.length) {
      const step = this.nextStep();
      try {
        const result = await appendJmapBlobAssembly(
          this.input.session,
          this.state.assemblyId!,
          step,
          this.input.signal,
        );
        this.state.appendedParts = appendedAfter(this.state.appendedParts, result);
        resynced = false;
      } catch (error) {
        if (error instanceof DriveAssemblyStepTooLargeError) {
          await this.shrinkStep(step.length);
          continue;
        }
        if (error instanceof DriveUploadPartsMissingError && missingRounds < MISSING_PART_ROUNDS) {
          missingRounds += 1;
          await this.resendMissing(error.blobIds);
          continue;
        }
        if (isInvalidArguments(error) && !resynced) {
          // The server and the stored progress disagree: ask the server.
          resynced = true;
          await this.syncAssembly();
          continue;
        }
        throw error;
      }
      await this.save({ phase: "assembling", assembledBytes: this.assembledBytes() });
    }
    return this.finish();
  }

  private nextStep(): Array<{ index: number; blobId: string }> {
    const budget = this.input.session.uploadCapabilities.assembly?.stepBudgetBytes ?? Infinity;
    const maxParts = this.state.stepParts ?? Infinity;
    const step: Array<{ index: number; blobId: string }> = [];
    let bytes = 0;
    for (let index = this.state.appendedParts; index < this.state.parts.length; index += 1) {
      const part = this.state.parts[index]!;
      if (step.length > 0 && (bytes + part.length > budget || step.length >= maxParts)) break;
      step.push({ index, blobId: part.blobId });
      bytes += part.length;
    }
    return step;
  }

  private async shrinkStep(stepLength: number): Promise<void> {
    if (stepLength <= 1) {
      throw new DriveUploadPermanentError(
        "The server refused to put this file together, even one part at a time.",
      );
    }
    this.state.stepParts = Math.max(1, Math.floor(stepLength / 2));
    await this.save({ phase: "assembling", assembledBytes: this.assembledBytes() });
  }

  /** Reads the assembly back; an expired one is opened again and filled from the start. */
  private async syncAssembly(): Promise<void> {
    const { session, signal } = this.input;
    const remote = await getJmapBlobAssembly(session, this.state.assemblyId!, signal);
    if (remote?.status === "finished" && remote.blobId) {
      this.state.blobId = remote.blobId;
    } else if (remote) {
      this.state.appendedParts = Math.min(remote.nextIndex, this.state.parts.length);
    } else {
      this.state.assemblyId = await createJmapBlobAssembly(
        session,
        this.size,
        this.input.mimeType,
        this.input.name,
        signal,
      );
      this.state.appendedParts = 0;
    }
    await this.save({ phase: "assembling", assembledBytes: this.assembledBytes() });
  }

  private async finish(): Promise<string> {
    const { session, signal } = this.input;
    const budget = session.uploadCapabilities.assembly?.stepBudgetBytes ?? this.size;
    // Each call finishes or advances a hash rebuild by one budget.
    const maxCalls = Math.ceil(this.size / Math.max(1, budget)) + 3;
    for (let call = 0; call < maxCalls; call += 1) {
      const blobId = await finishJmapBlobAssembly(session, this.state.assemblyId!, signal);
      if (blobId) {
        this.state.blobId = blobId;
        await this.save({ phase: "assembling", assembledBytes: this.size });
        return blobId;
      }
    }
    throw new DriveUploadPermanentError("The server did not finish putting the file together.");
  }
}

/**
 * Parts accepted after one append call. Parts the server lists as accepted
 * are never sent again; a call that only advanced a hash rebuild (after a
 * PHP upgrade) accepted none, so the same remaining parts go again.
 */
export function appendedAfter(
  appended: number,
  result: { accepted: readonly number[]; nextIndex: number },
): number {
  const accepted = new Set(result.accepted);
  let through = Math.max(appended, result.nextIndex);
  while (accepted.has(through)) through += 1;
  return through;
}

function isInvalidArguments(error: unknown): boolean {
  return error instanceof JmapMethodError && error.errorType === "invalidArguments";
}
